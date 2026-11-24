import type { EntityId } from './entity.js';
import { Entity } from './entity.js';

/**
 * Fixture: entity generic nhận mọi kiểu id thuộc `EntityId`,
 * dùng để kiểm tra các kiểu identity nguyên thủy (string, bigint).
 */
export class TypedEntity<Id extends EntityId> extends Entity<Id> {
  public constructor(id: Id) {
    super(id);
  }
}
