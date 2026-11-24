import { AggregateRoot } from './aggregate-root.js';
import type { Brand } from './brand.js';

export type ShipmentId = Brand<number, 'ShipmentId'>;

/** Fixture: aggregate root khác concrete class, để kiểm tra equality giữa các aggregate. */
export class Shipment extends AggregateRoot<ShipmentId> {
  public constructor(id: ShipmentId) {
    super(id);
  }
}
