import { Entity } from './entity.js';
import type { InvoiceId } from './invoice.fixture.js';

/** Fixture: plain Entity cùng kiểu id với Invoice, để kiểm tra equality khác concrete class. */
export class InvoiceLine extends Entity<InvoiceId> {
  public constructor(id: InvoiceId) {
    super(id);
  }
}
