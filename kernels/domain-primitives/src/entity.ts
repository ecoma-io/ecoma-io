/**
 * Các kiểu định danh được hỗ trợ cho domain entity.
 *
 * Nên dùng branded types để tránh trộn lẫn identifier
 * thuộc các domain concept khác nhau.
 */
export type EntityId = string | number | bigint;

/**
 * Lớp cơ sở cho domain entity.
 *
 * Độ tương đương (equality) của Entity được xác định bởi:
 * 1. Kiểu concrete của entity.
 * 2. Định danh (identity) của entity.
 *
 * Trạng thái của entity có thể thay đổi, nhưng identity là bất biến.
 */
export abstract class Entity<Id extends EntityId> {
  readonly #id: Id;

  protected constructor(id: Id) {
    this.#id = id;
  }

  /**
   * Trả về identity bất biến của entity này.
   */
  public get id(): Id {
    return this.#id;
  }

  /**
   * Xác định xem một entity khác có đại diện cho
   * cùng domain identity hay không.
   *
   * Các entity khác kiểu concrete không bao giờ equal,
   * ngay cả khi identifier của chúng có cùng giá trị.
   */
  public equals(other: unknown): boolean {
    if (this === other) {
      return true;
    }

    if (!(other instanceof Entity)) {
      return false;
    }

    return this.constructor === other.constructor && Object.is(this.#id, other.#id);
  }
}
