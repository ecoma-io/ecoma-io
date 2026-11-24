import { Entity } from './entity';
import type { EntityId } from './entity';

/**
 * Lớp cơ sở cho Aggregate Root.
 *
 * Aggregate Root là một Entity định nghĩa ranh giới nhất quán
 * (consistency boundary) của một Aggregate.
 *
 * Business invariants và các chuyển đổi trạng thái phải được
 * kiểm soát thông qua Aggregate Root.
 *
 * Lớp này cố ý không triển khai:
 * - Thu thập domain event
 * - Truy cập repository
 * - Persistence
 * - Quản lý transaction
 */
export abstract class AggregateRoot<Id extends EntityId> extends Entity<Id> {
  protected constructor(id: Id) {
    super(id);
  }
}
