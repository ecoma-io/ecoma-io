import type { Command } from '@ecoma-io/usecase-primitives';

import type {
  RequestOtpChallengeInput,
  RequestOtpChallengeOutput,
  RequestOtpChallengeUseCaseType,
} from './request-otp-challenge.js';
import type {
  VerifyOtpLoginInput,
  VerifyOtpLoginOutput,
  VerifyOtpLoginUseCaseType,
} from './verify-otp-login.js';

/**
 * Type-level tests: mọi use case OTP bắt buộc tuân thủ contract Command của
 * usecase-primitives qua implements.
 */
describe('otp use case contracts', () => {
  it('requestOtpChallengeUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<RequestOtpChallengeUseCaseType>().toExtend<
      Command<RequestOtpChallengeInput, RequestOtpChallengeOutput>
    >();
  });

  it('verifyOtpLoginUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<VerifyOtpLoginUseCaseType>().toExtend<
      Command<VerifyOtpLoginInput, VerifyOtpLoginOutput>
    >();
  });
});
