export {
  createMockAccountAdapter,
  MOCK_CONSENT_HANDLE,
  type MockAdapterOptions,
} from './mock-adapter';
export { createServerAccountAdapter } from './real-adapter';
export type {
  AccountAdapter,
  AccountEmail,
  AccountPreferences,
  AccountProfile,
  AccountSession,
  ColorMode,
  ConnectedApplication,
  ConsentContext,
  LoginChallenge,
  LoginChallengeMode,
  NotificationPreferences,
  Passkey,
  PrivacyRequest,
  PrivacyRequestKind,
  PrivacyRequestStatus,
  RecoveryCodesState,
  Result,
  TotpState,
} from './types';
