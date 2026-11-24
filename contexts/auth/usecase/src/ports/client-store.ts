import type { ClientId } from './types.js';

/**
 * Port danh mục client. Legacy chỉ phục vụ client active — store CHỈ trả client active
 * (client không active không thể phân biệt với client không tồn tại: non-oracle).
 */
export interface ClientStore {
  /** Undefined nếu không tồn tại hoặc không active. */
  findActiveClient(clientId: ClientId): Promise<
    | {
        id: ClientId;
        redirectUris: readonly string[];
        allowedScopes: readonly string[];
      }
    | undefined
  >;
}
