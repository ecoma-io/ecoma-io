import type { Query } from '@ecoma-io/usecase-primitives';

import type { GrantStore } from '../ports/grant-store.js';
import type { ClientId, Subject } from '../ports/types.js';

export interface ConnectedApplicationsListInput {
  readonly subject: Subject;
}

export interface ConnectedApplication {
  readonly clientId: ClientId;
  readonly grantId: string;
  readonly scopes: readonly string[];
  readonly grantedAt: Date;
}

export interface ConnectedApplicationsListOutput {
  readonly applications: readonly ConnectedApplication[];
}

/** Alias contract cho type-level test. */
export type ConnectedApplicationsListUseCaseType = Query<
  ConnectedApplicationsListInput,
  ConnectedApplicationsListOutput
>;

/** Giới hạn độ dài subject ở biên application — pre-DB (từ legacy). */
const MAX_SUBJECT_LENGTH = 200;

/** Query liệt kê connected applications của một subject. */
export class ConnectedApplicationsListQuery implements ConnectedApplicationsListUseCaseType {
  public constructor(private readonly grants: GrantStore) {}

  public async execute(
    input: ConnectedApplicationsListInput,
  ): Promise<ConnectedApplicationsListOutput> {
    if (input.subject.length > MAX_SUBJECT_LENGTH) {
      throw new Error('subject qua dai');
    }
    const applications = await this.grants.listConnectedApplications(input.subject);
    return { applications };
  }
}
