/**
 * Policy cấp phát token theo trạng thái account (§6.0).
 *
 * ⚠️ **Policy, không phải wire contract.** Hàm này thuộc tầng domain vì nó mã hoá một
 * quyết định nghiệp vụ — mọi trạng thái không phải `active` đều dẫn tới không cấp token
 * — trong khi contract của service `account` chỉ đóng gói shape của wire message. Đặt
 * policy vào contracts là đi ngược chiều phụ thuộc: contract là thứ provider publish,
 * không phải tầng để chứa logic gating của consumer.
 *
 * ⚠️ Type tại đây là union cục bộ thay vì nhập từ `@ecoma-io/account-contracts`:
 * project contracts chưa tồn tại trong repo (baseline typecheck fail vì import này).
 * Union liệt kê ĐỦ các giá trị canonical `active | suspended | deleted` khớp
 * `AccountStatus` của `account-domain` — khi contracts ra đời, type này được thay bằng
 * type nhập từ contract mà không đổi behavior.
 */

/**
 * Trạng thái canonical của account trên wire — khớp `AccountStatus` của
 * `@ecoma-io/account-domain`.
 */
export type AccountStatusValue = 'active' | 'suspended' | 'deleted';

/**
 * Mọi trạng thái không phải `active` đều dẫn tới không cấp token.
 */
export function allowsIssuance(status: AccountStatusValue): boolean {
  return status === 'active';
}
