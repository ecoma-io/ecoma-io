import type { Brand } from './brand.js';
import { Entity } from './entity.js';

export type UserId = Brand<string, 'UserId'>;

/** Fixture: entity với branded id, dùng chung cho các spec của Entity. */
export class User extends Entity<UserId> {
  public constructor(id: UserId) {
    super(id);
  }
}

export const asUserId = (value: string): UserId => value as UserId;
