/**
 * Nap cau hinh cua Worker `staff-access` tu binding.
 *
 * Nguyen tac giong `apps/pact-broker-api/src/config.ts` va `apps/auth/src/config.ts`:
 * **thieu cau hinh la loi, khong phai ly do doan**. Moi `require` nem
 * `StaffAccessAppConfigurationError` lam request fail-closed thay vi chay bang
 * default doan duoc. Message neu TEN bien trong loi — KHONG BAO GIO neu gia tri.
 */

/** Shape cua `env` ma Worker nhan tu binding + secrets. */
export interface StaffAccessEnv {
  /** Hyperdrive binding toi `db-staff-access`. Khong phai connection string. */
  DB_STAFF_ACCESS?: { connectionString: string };
}

/** Cau hinh da kiem, dung boi composition root. */
export interface StaffAccessConfig {
  readonly hyperdrive: { connectionString: string };
}

/**
 * Nem khi thieu/gia cau hinh. Thong bao neu TEN bien de nguoi van hanh biet
 * cap cai gi — nhung khong bao gio neu gia tri (cung luat F-07 cua auth).
 */
export class StaffAccessAppConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaffAccessAppConfigurationError';
  }
}

function requireHyperdrive(value: unknown): { connectionString: string } {
  if (value === undefined || value === null || typeof value !== 'object') {
    throw new StaffAccessAppConfigurationError(
      'Hyperdrive binding DB_STAFF_ACCESS has not been attached; staff-access fails closed',
    );
  }
  const cs = (value as { connectionString?: unknown }).connectionString;
  if (typeof cs !== 'string' || cs === '') {
    throw new StaffAccessAppConfigurationError(
      'Hyperdrive binding DB_STAFF_ACCESS has no connectionString; staff-access fails closed',
    );
  }
  return { connectionString: cs };
}

/** Nap va kiem toan bo cau hinh. `undefined`/`null` coi nhu env rong. */
export function loadStaffAccessConfig(
  envInput: StaffAccessEnv | undefined | null,
): StaffAccessConfig {
  const env: StaffAccessEnv = envInput ?? {};
  const hyperdrive = requireHyperdrive(env.DB_STAFF_ACCESS);
  return { hyperdrive };
}
