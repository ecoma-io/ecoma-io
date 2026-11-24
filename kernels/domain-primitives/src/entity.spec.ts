import type { OrderId } from './order.fixture.js';
import { Order } from './order.fixture.js';
import type { UserId } from './user.fixture.js';
import { User, asUserId } from './user.fixture.js';
import { TypedEntity } from './typed-entity.fixture.js';
import { Entity } from './entity.js';

const makeUser = (value: string): User => new User(asUserId(value));

describe('entity identity', () => {
  it('preserves the identity it was initialized with', () => {
    expect.hasAssertions();
    const user = makeUser('user-1');

    expect(user.id).toBe('user-1');
  });

  it('supports string identities', () => {
    expect.hasAssertions();
    const order = new Order('order-1' as OrderId);

    expect(order.id).toBe('order-1');
  });

  it('supports bigint identities', () => {
    expect.hasAssertions();
    const entity = new TypedEntity<bigint>(9_007_199_254_740_993n);

    expect(entity.id).toBe(9_007_199_254_740_993n);
  });

  it('cannot be mutated after initialization', () => {
    expect.hasAssertions();
    const user = makeUser('user-1');

    expect(() => {
      (user as { id: UserId }).id = asUserId('user-2');
    }).toThrow(/getter/u);
    expect(user.id).toBe('user-1');
  });
});

const expectNotEqual = (a: User, b: User): void => {
  expect(a.equals(b)).toBeFalsy();
};

describe('entity equality', () => {
  it('is equal to itself', () => {
    expect.hasAssertions();
    const user = makeUser('user-1');

    expect(user.equals(user)).toBe(true);
  });

  it('treats two instances of the same class with the same identity as equal', () => {
    expect.hasAssertions();
    const a = makeUser('user-1'),
      b = makeUser('user-1');

    expect(a.equals(b)).toBe(true);
    expect(b.equals(a)).toBe(true);
  });

  it('treats two instances of the same class with different identities as not equal', () => {
    expect.hasAssertions();
    expectNotEqual(makeUser('user-1'), makeUser('user-2'));
  });

  it('treats identities of different underlying types as not equal even with the same value', () => {
    expect.hasAssertions();
    const stringEntity = new TypedEntity<string>('1'),
      bigIntEntity = new TypedEntity<bigint>(1n);

    expect(stringEntity.equals(bigIntEntity)).toBeFalsy();
  });

  it('never treats entities of different concrete classes as equal, even with the same identity value', () => {
    expect.hasAssertions();
    const user = makeUser('shared-id'),
      order = new Order('shared-id' as OrderId);

    expect(user.equals(order)).toBeFalsy();
    expect(order.equals(user)).toBeFalsy();
  });

  it('returns false for null', () => {
    expect.hasAssertions();
    expect(makeUser('user-1').equals(undefined)).toBeFalsy();
  });

  it('returns false for a missing other value', () => {
    expect.hasAssertions();
    const user = makeUser('user-1');

    expect(user.equals(undefined)).toBeFalsy();
  });

  it('returns false for non-entity objects', () => {
    expect.hasAssertions();
    const user = makeUser('user-1');

    expect(user.equals({ id: 'user-1' })).toBeFalsy();
    expect(user.equals({})).toBeFalsy();
    expect(user.equals([])).toBeFalsy();
  });

  it('returns false for primitives', () => {
    expect.hasAssertions();
    const user = makeUser('user-1');

    expect(user.equals('user-1')).toBeFalsy();
    expect(user.equals(42)).toBeFalsy();
  });
});

describe('entity branded identifiers', () => {
  it('accepts branded identifiers as identity', () => {
    expect.hasAssertions();
    const user = makeUser('user-1');

    expect(user).toBeInstanceOf(Entity);
    expect(user.id).toBe('user-1');
  });

  it('keeps branded ids distinct from other brands at the type level', () => {
    expectTypeOf<User['id']>().toEqualTypeOf<UserId>();
    expectTypeOf<Order['id']>().toEqualTypeOf<OrderId>();
  });
});
