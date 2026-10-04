/**
 * Kiểu dữ liệu dùng chung của API, port từ upstream `src/types/index.ts`
 * (phần dùng cho HAL + matrix). Đã lược: `Env` của Workers (thay bằng
 * `AppEnv` trong `src/config.ts`), badge/UI types, DO types.
 */

// Kiểu Hono env dùng chung trong app.
export type AppEnv = {
  Bindings: Record<string, unknown>;
  Variables: AppVariables;
};

export interface AppVariables {
  requestId: string;
  /** Tenant đã xác thực (middleware auth gắn vào). */
  tenantId?: string;
  /** Tenant name đã xác thực. */
  tenantName?: string;
  /** Scopes của machine token (khi dùng token). */
  scopes?: string[];
  /** Pool mỗi isolate — middleware config gắn vào. */
  pool: import('pg').Pool;
  /** Config đã kiểm — middleware config gắn vào. */
  config: import('../config').PactBrokerConfig;
}

// Cấu trúc link HAL
export interface HalLink {
  href: string;
  title?: string;
  templated?: boolean;
  /** Dùng để chọn một link trong collection — xem `pb:record-deployment`. */
  name?: string;
}

export interface HalLinks {
  self: HalLink;
  [key: string]: HalLink | HalLink[] | undefined;
}

export interface HalResource {
  _links: HalLinks;
}

// Nội dung pact (đơn giản hoá)
export interface PactContent {
  consumer: { name: string };
  provider: { name: string };
  interactions: unknown[];
  metadata?: {
    pactSpecification?: { version: string };
    [key: string]: unknown;
  };
}

// API response types with HAL
export interface PactResponse extends HalResource {
  consumer: { name: string };
  provider: { name: string };
  consumerVersion: string;
  contentSha: string;
  createdAt: string;
  interactions: unknown[];
  metadata?: Record<string, unknown>;
}

export interface VerificationResultRequest {
  success: boolean;
  providerApplicationVersion: string;
  buildUrl?: string;
}

export interface VerificationResultResponse extends HalResource {
  success: boolean;
  providerApplicationVersion: string;
  buildUrl?: string | null;
  verifiedAt: string;
}

/**
 * Một matrix row như repo layer trả về — chưa có HAL, vì chỉ request mới biết
 * host public của broker. `MatrixRow` dưới đây là bản decorate link ở route.
 */
export interface MatrixVersionData {
  number: string;
  branch: string | null;
  tags: string[];
}

/**
 * Cách một mũi nhọn `to` / `tag` / `environment` được resolve cho một hàng.
 * `resolved: false` nghĩa là target không trỏ vào gì — một fact khác với
 * "chưa ai verify", và được báo cáo phân biệt như vậy.
 */
export interface MatrixTarget {
  type: 'tag' | 'branch' | 'environment';
  value: string;
  resolved: boolean;
}

export interface MatrixRowData {
  consumer: { name: string; version: MatrixVersionData };
  provider: { name: string; version: MatrixVersionData | null; target?: MatrixTarget };
  pact: { sha: string; createdAt: string };
  verification: { id: string; success: boolean; verifiedAt: string } | null;
}

/**
 * Hình dạng wire, theo matrix_decorator.rb. `version` là OBJECT ở cả hai bên:
 * pact_broker-client's TextFormatter đọc `row[:consumer][:version][:number]`,
 * và một string trần ở đó raise TypeError trong Ruby thay vì giảm dần.
 */
export interface MatrixVersion extends HalResource {
  number: string;
  branch: string | null;
  tags: Array<{ name: string }>;
}

export interface MatrixRow {
  consumer: { name: string; version: MatrixVersion } & HalResource;
  provider: { name: string; version: MatrixVersion | null } & HalResource;
  pact: { createdAt: string } & HalResource;
  verificationResult:
    | ({
        success: boolean;
        verifiedAt: string;
      } & HalResource)
    | null;
}

export interface MatrixResponse extends HalResource {
  summary: import('./matrix-summary').MatrixSummary;
  notices: import('./matrix-summary').MatrixNotice[];
  matrix: MatrixRow[];
}

export interface CanIDeployResponse extends HalResource {
  summary: import('./matrix-summary').MatrixSummary;
  notices: import('./matrix-summary').MatrixNotice[];
  matrix: MatrixRow[];
}

export interface PacticipantResponse extends HalResource {
  name: string;
  createdAt: string;
}
