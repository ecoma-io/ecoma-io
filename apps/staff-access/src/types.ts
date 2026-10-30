import type { StaffAccessConfig } from './config';

/**
 * Context Hono cua Worker — bien do composition root set vao context sau khi
 * config da duoc kiem (middleware config). Route cua Milestone B doc tu day
 * thay vi doc `env` truc tiep, de duong config khong ro lech giua cac route.
 */
export interface AppEnv {
  readonly Variables: {
    config: StaffAccessConfig;
    requestId: string;
  };
  readonly Bindings: {
    DB_STAFF_ACCESS?: { connectionString: string };
  };
}
