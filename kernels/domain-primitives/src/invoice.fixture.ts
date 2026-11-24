import { AggregateRoot } from './aggregate-root.js';
import type { Brand } from './brand.js';

export type InvoiceId = Brand<string, 'InvoiceId'>;

/** Fixture: aggregate root dùng cho spec của AggregateRoot. */
export class Invoice extends AggregateRoot<InvoiceId> {
  public constructor(id: InvoiceId) {
    super(id);
  }
}
