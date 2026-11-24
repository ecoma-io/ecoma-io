import { AggregateRoot } from './aggregate-root.js';
import { Entity } from './entity.js';
import type { InvoiceId } from './invoice.fixture.js';
import { Invoice } from './invoice.fixture.js';
import { InvoiceLine } from './invoice-line.fixture.js';
import type { ShipmentId } from './shipment.fixture.js';
import { Shipment } from './shipment.fixture.js';

const makeInvoice = (value: string): Invoice => new Invoice(value as InvoiceId);

describe('AggregateRoot', () => {
  it('extends Entity', () => {
    expect.hasAssertions();
    const invoice = makeInvoice('inv-1');

    expect(invoice).toBeInstanceOf(Entity);
    expect(invoice).toBeInstanceOf(AggregateRoot);
  });

  it('preserves its identity', () => {
    expect.hasAssertions();
    const invoice = makeInvoice('inv-1');

    expect(invoice.id).toBe('inv-1');
  });

  it('treats two aggregate roots of the same class with the same identity as equal', () => {
    expect.hasAssertions();
    const a = makeInvoice('inv-1'),
      b = makeInvoice('inv-1');

    expect(a.equals(b)).toBe(true);
    expect(b.equals(a)).toBe(true);
  });

  it('treats two aggregate roots of the same class with different identities as not equal', () => {
    expect.hasAssertions();
    const a = makeInvoice('inv-1'),
      b = makeInvoice('inv-2');

    expect(a.equals(b)).toBeFalsy();
  });

  it('is not equal to a plain Entity of a different concrete class, even with the same identity', () => {
    expect.hasAssertions();
    const invoice = makeInvoice('inv-1'),
      line = new InvoiceLine('inv-1' as InvoiceId);

    expect(invoice.equals(line)).toBeFalsy();
    expect(line.equals(invoice)).toBeFalsy();
  });

  it('is not equal to an aggregate root of a different concrete class', () => {
    expect.hasAssertions();
    const invoice = makeInvoice('x'),
      shipment = new Shipment(0 as ShipmentId);

    expect(invoice.equals(shipment)).toBeFalsy();
  });

  it('inherits equality semantics from Entity', () => {
    expect.hasAssertions();
    const invoice = makeInvoice('inv-1');

    // Các semantics kế thừa từ Entity: reflexive, chống null/undefined
    // Và chống object không phải entity.
    expect(invoice.equals(invoice)).toBe(true);
    expect(invoice.equals(undefined)).toBeFalsy();
    expect(invoice.equals({ id: 'inv-1' })).toBeFalsy();
  });

  it('exposes the same id type as its Entity base', () => {
    expectTypeOf<Invoice['id']>().toEqualTypeOf<InvoiceId>();
    expectTypeOf<Shipment['id']>().toEqualTypeOf<ShipmentId>();
  });
});
