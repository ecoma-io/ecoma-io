import type { Brand } from './brand.js';
import { Entity } from './entity.js';

export type OrderId = Brand<string, 'OrderId'>;

/** Fixture: entity với branded id khác, để kiểm tra equality giữa các concrete class. */
export class Order extends Entity<OrderId> {
  public constructor(id: OrderId) {
    super(id);
  }
}
