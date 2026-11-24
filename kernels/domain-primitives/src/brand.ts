declare const brand: unique symbol;

/**
 * Gắn nhãn kiểu (brand) lên kiểu cơ sở `T` để tạo ra một kiểu danh nghĩa (nominal type).
 *
 * Hai giá trị chỉ có thể gán cho nhau khi cả kiểu cơ sở và tên brand đều khớp,
 * giúp trình biên dịch phân biệt các identifier có cùng kiểu nền (ví dụ `UserId`
 * và `OrderId` đều là `string`) ngay tại compile time.
 */
export type Brand<T, Name extends string> = T & {
  readonly [brand]: Name;
};
