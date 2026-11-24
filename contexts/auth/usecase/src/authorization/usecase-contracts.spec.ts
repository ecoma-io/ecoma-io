import type { Command } from '@ecoma-io/usecase-primitives';

import type {
  BeginAuthorizationInput,
  BeginAuthorizationOutput,
  BeginAuthorizationUseCaseType,
} from './begin-authorization.js';
import type {
  CompleteAuthorizationInput,
  CompleteAuthorizationOutput,
  CompleteAuthorizationUseCaseType,
} from './complete-authorization.js';
import type {
  ConfirmBrowserInput,
  ConfirmBrowserOutput,
  ConfirmBrowserUseCaseType,
} from './confirm-browser.js';

/**
 * Type-level tests: mọi use case authorization bắt buộc tuân thủ contract
 * Command<Input, Output> của usecase-primitives qua implements.
 */
describe('authorization use case contracts', () => {
  it('beginAuthorizationUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<BeginAuthorizationUseCaseType>().toExtend<
      Command<BeginAuthorizationInput, BeginAuthorizationOutput>
    >();
  });

  it('confirmBrowserUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<ConfirmBrowserUseCaseType>().toExtend<
      Command<ConfirmBrowserInput, ConfirmBrowserOutput>
    >();
  });

  it('completeAuthorizationUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<CompleteAuthorizationUseCaseType>().toExtend<
      Command<CompleteAuthorizationInput, CompleteAuthorizationOutput>
    >();
  });
});
