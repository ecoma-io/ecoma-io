import type { Command } from '@ecoma-io/usecase-primitives';

import { OAuthProtocolError } from '@ecoma-io/auth-domain';

import type { GrantStore } from '../ports/grant-store.js';
import type { ClientId, GrantId, Subject } from '../ports/types.js';

export interface ConnectedApplicationsRevokeInput {
  readonly subject: Subject;
  readonly grantId: GrantId;
  /** Client của grant — bắt buộc để ghi client-level revocation đúng chủ thể. */
  readonly clientId: ClientId;
}

export interface ConnectedApplicationsRevokeOutput {
  readonly revoked: boolean;
}

/** Alias contract cho type-level test. */
export type ConnectedApplicationsRevokeUseCaseType = Command<
  ConnectedApplicationsRevokeInput,
  ConnectedApplicationsRevokeOutput
>;

/** UUID shape — validate pre-DB (từ legacy connected-applications-handler). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Command revoke một connected application.
 *
 * Non-oracle: CAS loss trả 404 giống hệt "grant chưa từng tồn tại" — không
 * phân biệt already-revoked vs never-existed (bất biến từ legacy).
 */
export class ConnectedApplicationsRevokeUseCase implements ConnectedApplicationsRevokeUseCaseType {
  public constructor(private readonly grants: GrantStore) {}

  public async execute(
    input: ConnectedApplicationsRevokeInput,
  ): Promise<ConnectedApplicationsRevokeOutput> {
    if (!UUID_RE.test(input.grantId)) {
      throw OAuthProtocolError.directInvalidRequest('grant id khong dung dinh dang');
    }

    const outcome = await this.grants.revokeGrantWithClientRevocation({
      clientId: input.clientId,
      grantId: input.grantId,
      source: 'auth',
      subject: input.subject,
    });
    if (outcome === 'lost') {
      throw new OAuthProtocolError('invalid_grant', 404, { redirectable: false });
    }
    return { revoked: true };
  }
}
