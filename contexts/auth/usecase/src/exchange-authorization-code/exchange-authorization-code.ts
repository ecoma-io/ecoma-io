import type { Command } from '@ecoma-io/usecase-primitives';

import {
  OAuthProtocolError,
  assertGrantCoversScope,
  assertRegisteredRedirectUri,
  assertValidCodeVerifier,
  isIssuable,
  verifyCodeChallenge,
} from '@ecoma-io/auth-domain';

import type { AuthorizationCodeRedeemer } from '../ports/authorization-code-redeemer.js';
import type { AccountStatusChecker, RevocationChecker } from '../ports/account-status-checker.js';
import type { ClientStore } from '../ports/client-store.js';
import type { GrantStore } from '../ports/grant-store.js';
import type { HandleService } from '../ports/handle-service.js';
import type { AccessTokenIssuer, RefreshTokenIssuer } from '../ports/token-issuer.js';
import type { ClientId, Handle } from '../ports/types.js';

export interface ExchangeAuthorizationInput {
  /** Authorization code trình bày ở /token — chính là handle Z plaintext. */
  readonly code: Handle;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly clientId: ClientId;
}

export interface ExchangeAuthorizationOutput {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly refreshTokenExpiresIn: number;
  readonly scope: readonly string[];
}

/** Alias contract cho type-level test. */
export type ExchangeAuthorizationUseCaseType = Command<
  ExchangeAuthorizationInput,
  ExchangeAuthorizationOutput
>;

/** TTL mặc định của access token yêu cầu — infrastructure clamp về MAX 900s. */
const REQUESTED_ACCESS_TOKEN_TTL_SECONDS = 300;

/**
 * Command đổi authorization code lấy token (grant type `authorization_code`).
 *
 * Bất biến từ legacy:
 * - Consume code là CAS one-shot theo hash — consumed/expired/unknown cùng một
 *   kết quả (non-oracle).
 * - redirect_uri được so lại EXACT với giá trị ghi trong transaction, KHÔNG
 *   đọc lại từ query (FR-009k); lỗi ở token endpoint không redirectable.
 * - PKCE S256 bắt buộc; verifier sai → invalid_grant (không tiết lộ nguyên nhân).
 * - Fail-closed gates trước khi cấp token: account `active`, revocation
 *   `not_revoked`, grant active + đủ scope (assertGrantCoversScope).
 * - Thứ tự: verify client → redirect → consume code → PKCE → redirect match
 *   → gates → issue tokens. Mọi lỗi business ở token endpoint dùng biến thể
 *   `direct*` — KHÔNG BAO GIỜ redirectable (legacy invalidGrant trực tiếp).
 */
export class ExchangeAuthorizationCodeUseCase implements ExchangeAuthorizationUseCaseType {
  public constructor(
    private readonly clients: ClientStore,
    private readonly redeemer: AuthorizationCodeRedeemer,
    private readonly grants: GrantStore,
    private readonly handles: HandleService,
    private readonly accountStatus: AccountStatusChecker,
    private readonly revocation: RevocationChecker,
    private readonly accessTokenIssuer: AccessTokenIssuer,
    private readonly refreshTokenIssuer: RefreshTokenIssuer,
  ) {}

  public async execute(input: ExchangeAuthorizationInput): Promise<ExchangeAuthorizationOutput> {
    const client = await this.clients.findActiveClient(input.clientId);
    if (client === undefined) {
      throw OAuthProtocolError.invalidClient('client khong hoat dong hoac khong ton tai');
    }

    // Redirect_uri re-check theo bản đăng ký — non-redirectable tại token endpoint.
    assertRegisteredRedirectUri(input.redirectUri, client.redirectUris, { kind: 'exact' });

    assertValidCodeVerifier(input.codeVerifier);

    // Consume code (one-shot CAS) + đọc context nguyên tử cùng lúc.
    const codeHash = await this.handles.hashHandle(input.code),
      redeemed = await this.redeemer.redeem({ codeHash });
    if (redeemed === undefined) {
      throw OAuthProtocolError.directInvalidGrant('code khong hop le hoac da su dung');
    }

    // PKCE verify trước khi tiết lộ bất kỳ thứ gì thêm.
    const pkceOk = await verifyCodeChallenge({
      codeVerifier: input.codeVerifier,
      expectedChallenge: redeemed.codeChallenge,
    });
    if (!pkceOk) {
      throw OAuthProtocolError.directInvalidGrant('pkce khong khop');
    }

    // Redirect_uri phải khớp EXACT giá trị ghi trong transaction — không đọc từ query.
    if (redeemed.redirectUri !== input.redirectUri) {
      throw OAuthProtocolError.directInvalidGrant('redirect_uri khong khop transaction');
    }

    // Fail-closed gates.
    const status = await this.accountStatus.check(redeemed.subject);
    if (status.status !== 'active') {
      throw OAuthProtocolError.directInvalidGrant('account khong the cap token');
    }
    const revocationResult = await this.revocation.checkAtIssuance({
      clientId: input.clientId,
      subject: redeemed.subject,
    });
    if (!isIssuable(revocationResult)) {
      throw OAuthProtocolError.directInvalidGrant('token da bi thu hoi');
    }

    const grant = await this.grants.findActiveGrant(redeemed.subject, input.clientId);
    assertGrantCoversScope(
      grant === undefined ? undefined : { isActive: grant.isActive, scopes: grant.scopes },
      redeemed.scope,
    );
    if (grant === undefined) {
      // AssertGrantCoversScope đã chặn grant undefined ở trên — nhánh này chỉ để thu hẹp kiểu.
      throw OAuthProtocolError.directInvalidGrant('grant khong con hieu luc');
    }
    const activeGrantId = grant.id,
      // Cấp token. TTL cụ thể là concern Infrastructure (clamp về MAX 900s).
      at = await this.accessTokenIssuer.issueAccessToken({
        clientId: input.clientId,
        grantId: activeGrantId,
        scope: redeemed.scope,
        subject: redeemed.subject,
        ttlSeconds: REQUESTED_ACCESS_TOKEN_TTL_SECONDS,
      }),
      rt = await this.refreshTokenIssuer.issueOrRotate({
        clientId: input.clientId,
        familyId: undefined,
        grantId: activeGrantId,
        scope: redeemed.scope,
        subject: redeemed.subject,
      });

    return {
      accessToken: at.accessToken,
      expiresIn: at.expiresIn,
      refreshToken: rt.refreshToken,
      refreshTokenExpiresIn: rt.expiresIn,
      scope: redeemed.scope,
      tokenType: at.tokenType,
    };
  }
}
