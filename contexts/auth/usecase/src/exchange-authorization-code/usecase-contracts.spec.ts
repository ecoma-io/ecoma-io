import type { Command } from '@ecoma-io/usecase-primitives';

import type {
  ExchangeAuthorizationInput,
  ExchangeAuthorizationOutput,
  ExchangeAuthorizationUseCaseType,
} from './exchange-authorization-code.js';

/**
 * Type-level tests: use case exchange code bắt buộc tuân thủ contract
 * Command của usecase-primitives qua implements.
 */
describe('exchange-authorization-code use case contract', () => {
  it('exchangeAuthorizationUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<ExchangeAuthorizationUseCaseType>().toExtend<
      Command<ExchangeAuthorizationInput, ExchangeAuthorizationOutput>
    >();
  });
});
