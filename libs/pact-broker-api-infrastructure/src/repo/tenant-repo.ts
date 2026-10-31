/**
 * Tenant repo — ensureDefaultTenant race-safe + membership/RBAC + machine
 * token management (Phase 2).
 *
 * ensureDefaultTenant — 4 bước (docs/domains/pact-broker/01-architecture.md
 * §4): INSERT ON CONFLICT DO NOTHING RETURNING → select lại nếu RETURNING
 * rỗng → fail-closed nếu tenant ở trạng thái deleted/suspended → DO NOTHING
 * cho membership owner. Race giữa hai bootstrap đồng thời chỉ cho một INSERT
 * thắng; bên thua đọc hàng của bên thắng.
 *
 * Token: 32 byte entropy, base64url; chỉ hash SHA-256 nằm DB. Token bản rõ
 * trả đúng MỘT lần lúc tạo (show-once); revoke = set revoked_at, hiệu lực tức
 * thời vì mọi request tra hash rồi check.
 */
import type { Pool } from 'pg';
import { randomToken, sha256Hex } from '@ecoma-io/pact-broker-api-application';

export interface TenantRecord {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'deleted';
}

export interface MachineTokenRecord {
  id: string;
  tenantId: string;
  name: string;
  scopes: string;
  createdAt: string;
  revokedAt: string | null;
}

export class PactBrokerTenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PactBrokerTenantError';
  }
}

export class PgTenantRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * Bảo đảm tenant `name` tồn tại ACTIVE và `ownerSub` là owner. Idempotent,
   * race-safe. Ném `PactBrokerTenantError` khi tenant tồn tại ở trạng thái
   * deleted (fail-closed — không tự sửa dữ liệu đã xoá mềm).
   */
  async ensureDefaultTenant(name: string, ownerSub: string): Promise<TenantRecord> {
    return this.pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');

        // Bước 1: thử INSERT. RETURNING rỗng = đã có (kể cả do race).
        const inserted = await client.query<{ id: string; name: string; status: string }>(
          `INSERT INTO pact.tenants (name) VALUES ($1)
           ON CONFLICT (name) DO NOTHING
           RETURNING id, name, status`,
          [name],
        );

        let tenant: { id: string; name: string; status: string };
        if (inserted.rows[0]) {
          tenant = inserted.rows[0];
        } else {
          // Bước 2: select lại hàng của bên thắng race.
          const existing = await client.query<{ id: string; name: string; status: string }>(
            `SELECT id, name, status FROM pact.tenants WHERE name = $1`,
            [name],
          );
          if (existing.rows[0] === undefined) {
            throw new PactBrokerTenantError(`tenant ${name} vanished during bootstrap`);
          }
          tenant = existing.rows[0];
        }

        // Bước 3: fail-closed nếu tenant đã xoá/tạm dừng — bootstrap không
        // được âm thầm hồi sinh tenant đã xoá mềm.
        if (tenant.status !== 'active') {
          throw new PactBrokerTenantError(
            `tenant ${name} is ${tenant.status}; refusing to bootstrap`,
          );
        }

        // Bước 4: membership owner — DO NOTHING nếu đã có (không đổi role
        // thành viên hiện có).
        await client.query(
          `INSERT INTO pact.tenant_members (tenant_id, sub, role)
           VALUES ($1, $2, 'owner')
           ON CONFLICT (tenant_id, sub) DO NOTHING`,
          [tenant.id, ownerSub],
        );

        await client.query('COMMIT');
        return tenant as TenantRecord;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async getTenantByName(name: string): Promise<TenantRecord | null> {
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      status: 'active' | 'suspended' | 'deleted';
    }>(`SELECT id, name, status FROM pact.tenants WHERE name = $1`, [name]);
    return rows[0] ?? null;
  }

  /**
   * Bảo đảm tenant `name` tồn tại ACTIVE, idempotent, race-safe. Không tạo
   * membership — chỉ đảm bảo hàng tenant. Dùng bởi consumer entitlement (P3.2)
   * trước khi upsert membership theo event.
   *
   * Ném `PactBrokerTenantError` khi tenant tồn tại ở trạng thái deleted
   * (fail-closed — không tự sửa dữ liệu đã xoá mềm).
   */
  async ensureTenant(name: string): Promise<string> {
    return this.pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');

        const inserted = await client.query<{ id: string; status: string }>(
          `INSERT INTO pact.tenants (name) VALUES ($1)
           ON CONFLICT (name) DO NOTHING
           RETURNING id, status`,
          [name],
        );

        let tenant: { id: string; status: string };
        if (inserted.rows[0]) {
          tenant = inserted.rows[0];
        } else {
          const existing = await client.query<{ id: string; status: string }>(
            `SELECT id, status FROM pact.tenants WHERE name = $1`,
            [name],
          );
          if (existing.rows[0] === undefined) {
            throw new PactBrokerTenantError(`tenant ${name} vanished during bootstrap`);
          }
          tenant = existing.rows[0];
        }

        if (tenant.status !== 'active') {
          throw new PactBrokerTenantError(`tenant ${name} is ${tenant.status}; refusing to use`);
        }

        await client.query('COMMIT');
        return tenant.id;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  /** Upsert membership `(tenant_id, sub, role)` — DO NOTHING nếu đã có. */
  async upsertMember(tenantId: string, sub: string, role: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO pact.tenant_members (tenant_id, sub, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, sub) DO NOTHING`,
      [tenantId, sub, role],
    );
  }

  /** Role của sub trong tenant; null khi không là member. */
  async getMemberRole(tenantId: string, sub: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ role: string }>(
      `SELECT role FROM pact.tenant_members WHERE tenant_id = $1 AND sub = $2`,
      [tenantId, sub],
    );
    return rows[0]?.role ?? null;
  }

  // ============ machine tokens ============

  /**
   * Tạo token mới. Trả bản rõ ĐÚNG MỘT LẦN — chỉ hash nằm DB. Caller chịu
   * trách nhiệm không log giá trị này.
   */
  async createMachineToken(
    tenantId: string,
    actorSub: string | null,
    name: string,
    scopes: string[],
  ): Promise<{ token: string; record: MachineTokenRecord }> {
    // 32 byte entropy = 192 bit, base64url không padding.
    const raw = randomToken();
    const tokenHash = await sha256Hex(raw);

    const { rows } = await this.pool.query<{
      id: string;
      tenant_id: string;
      scopes: string;
      created_at: Date;
    }>(
      `INSERT INTO pact.machine_tokens (token_hash, tenant_id, name, created_by_sub, scopes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, scopes, created_at`,
      [tokenHash, tenantId, name, actorSub, scopes.join(' ')],
    );
    const row = rows[0];
    return {
      token: raw,
      record: {
        id: row.id,
        tenantId: row.tenant_id,
        name,
        scopes: row.scopes,
        createdAt: row.created_at.toISOString(),
        revokedAt: null,
      },
    };
  }

  async listMachineTokens(tenantId: string): Promise<Array<MachineTokenRecord>> {
    const { rows } = await this.pool.query<{
      id: string;
      tenant_id: string;
      name: string;
      scopes: string;
      created_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, tenant_id, name, scopes, created_at, revoked_at
         FROM pact.machine_tokens
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      scopes: r.scopes,
      createdAt: r.created_at.toISOString(),
      revokedAt: r.revoked_at === null ? null : r.revoked_at.toISOString(),
    }));
  }

  /** Revoke — set revoked_at; hiệu lực tức thời. false khi không tìm thấy. */
  async revokeMachineToken(tenantId: string, tokenId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE pact.machine_tokens
          SET revoked_at = now()
        WHERE tenant_id = $1 AND id = $2::uuid AND revoked_at IS NULL`,
      [tenantId, tokenId],
    );
    return (rowCount ?? 0) > 0;
  }
}
