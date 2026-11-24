import type { Command, Query } from '@ecoma-io/usecase-primitives';

import type {
  ConsentContextInput,
  ConsentContextOutput,
  ConsentContextUseCaseType,
} from './consent-context.js';
import type {
  ConsentDecideInput,
  ConsentDecideOutput,
  ConsentDecideUseCaseType,
} from './consent-decide.js';

/**
 * Type-level tests: mọi use case consent bắt buộc tuân thủ contract
 * Command/Query của usecase-primitives qua implements.
 */
describe('consent use case contracts', () => {
  it('consentContextUseCaseType implements Query with matching execute signature', () => {
    expectTypeOf<ConsentContextUseCaseType>().toExtend<
      Query<ConsentContextInput, ConsentContextOutput>
    >();
  });

  it('consentDecideUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<ConsentDecideUseCaseType>().toExtend<
      Command<ConsentDecideInput, ConsentDecideOutput>
    >();
  });
});
