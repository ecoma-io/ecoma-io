import type { Command, Query } from '@ecoma-io/usecase-primitives';

import type {
  ConnectedApplicationsListInput,
  ConnectedApplicationsListOutput,
  ConnectedApplicationsListUseCaseType,
} from './connected-applications-list.js';
import type {
  ConnectedApplicationsRevokeInput,
  ConnectedApplicationsRevokeOutput,
  ConnectedApplicationsRevokeUseCaseType,
} from './connected-applications-revoke.js';

/**
 * Type-level tests: mọi use case connected-applications bắt buộc tuân thủ contract
 * Command/Query của usecase-primitives qua implements.
 */
describe('connected-applications use case contracts', () => {
  it('connectedApplicationsListUseCaseType implements Query with matching execute signature', () => {
    expectTypeOf<ConnectedApplicationsListUseCaseType>().toExtend<
      Query<ConnectedApplicationsListInput, ConnectedApplicationsListOutput>
    >();
  });

  it('connectedApplicationsRevokeUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<ConnectedApplicationsRevokeUseCaseType>().toExtend<
      Command<ConnectedApplicationsRevokeInput, ConnectedApplicationsRevokeOutput>
    >();
  });
});
