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
  /** Storage config — tat ca optional; thieu thi data plane fail-closed 503. */
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  /** Gioi han kich thuoc artifact (byte). Mac dinh 512 MiB neu khong cau hinh. */
  MAX_ARTIFACT_SIZE?: string;
}

/** Cau hinh da kiem, dung boi composition root. */
export interface RemoteCacheConfig {
  readonly hyperdrive: { connectionString: string };
  readonly storage: {
    readonly endpoint: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  } | null;
  readonly maxArtifactSize: number;
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

  // Storage: tat ca optional — thieu bat ky field thi data plane fail-closed 503
  // (khong co default storage). Khong nem khi thieu; route tra 503 khi storage null.
  const storage =
    env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? {
          endpoint: env.S3_ENDPOINT,
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        }
      : null;

  const maxArtifactSize =
    env.MAX_ARTIFACT_SIZE &&
    Number.isFinite(Number(env.MAX_ARTIFACT_SIZE)) &&
    Number(env.MAX_ARTIFACT_SIZE) > 0
      ? Number(env.MAX_ARTIFACT_SIZE)
      : 512 * 1024 * 1024;

  return { hyperdrive, storage, maxArtifactSize };
}
