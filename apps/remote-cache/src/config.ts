/**
 * Nap cau hinh cua Worker `remote-cache` tu binding (ADR-0015, P4.1).
 *
 * Nguyen tac giong `apps/staff-access/src/config.ts`: **thieu cau hinh la
 * loi, khong phai ly do doan**. Moi `require` nem
 * `RemoteCacheAppConfigurationError` lam request fail-closed thay vi chay
 * bang default doan duoc. Message neu TEN bien trong loi — KHONG BAO GIO
 * neu gia tri.
 */

/** Shape cua `env` ma Worker nhan tu binding + secrets. */
export interface RemoteCacheEnv {
  /** Hyperdrive binding toi `db-remote-cache`. Khong phai connection string. */
  DB_REMOTE_CACHE?: { connectionString: string };
}

/** Cau hinh da kiem, dung boi composition root. */
export interface RemoteCacheConfig {
  readonly hyperdrive: { connectionString: string };
}

/**
 * Nem khi thieu/gia cau hinh. Thong bao neu TEN bien de nguoi van hanh biet
 * cap cai gi — nhung khong bao gio neu gia tri.
 */
export class RemoteCacheAppConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteCacheAppConfigurationError';
  }
}

function requireHyperdrive(value: unknown): { connectionString: string } {
  if (value === undefined || value === null || typeof value !== 'object') {
    throw new RemoteCacheAppConfigurationError(
      'Hyperdrive binding DB_REMOTE_CACHE has not been attached; remote-cache fails closed',
    );
  }
  const cs = (value as { connectionString?: unknown }).connectionString;
  if (typeof cs !== 'string' || cs === '') {
    throw new RemoteCacheAppConfigurationError(
      'Hyperdrive binding DB_REMOTE_CACHE has no connectionString; remote-cache fails closed',
    );
  }
  return { connectionString: cs };
}

/** Nap va kiem toan bo cau hinh. `undefined`/`null` coi nhu env rong. */
export function loadRemoteCacheConfig(
  envInput: RemoteCacheEnv | undefined | null,
): RemoteCacheConfig {
  const env: RemoteCacheEnv = envInput ?? {};
  const hyperdrive = requireHyperdrive(env.DB_REMOTE_CACHE);
  return { hyperdrive };
}
