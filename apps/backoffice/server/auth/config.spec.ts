/**
 * Test của cổng cấu hình OIDC — `backofficeAuthConfig` là điểm mà middleware
 * authn, login và callback cùng đi qua, và `null` của nó là tín hiệu `503`
 * fail-closed ("chưa cấu hình" không phải "cho qua"). Bốn bất biến được ghim:
 *
 * 1. **Đủ cả ba biến mới mở cổng** — thiếu một biến là luồng login không dựng
 *    được đúng contract (authorize URL sai, token sai audience hay sai
 *    client); hàm trả `null` **chung** cho mọi dạng thiếu, không lộ biến nào
 *    thiếu.
 * 2. **Env Worker trước, runtimeConfig Nitro sau** — hai runtime của app đọc
 *    cùng một module: Workers đọc `env`, container Node local đọc
 *    runtimeConfig private; env có giá trị thì runtimeConfig không được thắng.
 * 3. **Giá trị rỗng không phải giá trị** — một biến có mặt nhưng chuỗi rỗng
 *    là "chưa cấu hình", không phải "đã cấu hình với giá trị rỗng".
 * 4. **Không ném khi không có runtimeConfig** — test dựng h3 app trực tiếp
 *    thì `useRuntimeConfig` ném; đường đó phải rơi về `null` như mọi nhánh
 *    chưa cấu hình khác, không phải một lỗi khác hỏng phân loại 503.
 */

import type { H3Event } from 'h3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BACKOFFICE_AUTH_AUDIENCE_ENV,
  BACKOFFICE_AUTH_CLIENT_ID_ENV,
  BACKOFFICE_AUTH_ISSUER_ENV,
  backofficeAuthConfig,
} from './config';

const FULL_ENV = {
  [BACKOFFICE_AUTH_ISSUER_ENV]: 'https://auth.test.ecoma.io',
  [BACKOFFICE_AUTH_AUDIENCE_ENV]: 'https://api.test.ecoma.io/backoffice',
  [BACKOFFICE_AUTH_CLIENT_ID_ENV]: 'backoffice-test',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Event giả — module này chỉ đọc `context.cloudflare.env` và runtimeConfig. */
function fakeEvent(workerEnv: unknown): H3Event {
  return {
    context: { cloudflare: workerEnv === undefined ? undefined : { env: workerEnv } },
  } as unknown as H3Event;
}

describe('backofficeAuthConfig — opens only on the full triple', () => {
  it('accepts the complete configuration from the Worker env', () => {
    expect(backofficeAuthConfig(fakeEvent(FULL_ENV))).toEqual({
      issuer: 'https://auth.test.ecoma.io',
      audience: 'https://api.test.ecoma.io/backoffice',
      clientId: 'backoffice-test',
    });
  });

  it('returns null when any single variable is missing', () => {
    // Mutation evidence: đổi điều kiện "cả ba" thành chỉ kiểm issuer thì test
    // dòng audience/clientId đỏ — thiếu một biến phải đụng toàn luồng 503.
    const partials: Record<string, Record<string, string>> = {
      issuer: {
        [BACKOFFICE_AUTH_AUDIENCE_ENV]: FULL_ENV[BACKOFFICE_AUTH_AUDIENCE_ENV],
        [BACKOFFICE_AUTH_CLIENT_ID_ENV]: FULL_ENV[BACKOFFICE_AUTH_CLIENT_ID_ENV],
      },
      audience: {
        [BACKOFFICE_AUTH_ISSUER_ENV]: FULL_ENV[BACKOFFICE_AUTH_ISSUER_ENV],
        [BACKOFFICE_AUTH_CLIENT_ID_ENV]: FULL_ENV[BACKOFFICE_AUTH_CLIENT_ID_ENV],
      },
      clientId: {
        [BACKOFFICE_AUTH_ISSUER_ENV]: FULL_ENV[BACKOFFICE_AUTH_ISSUER_ENV],
        [BACKOFFICE_AUTH_AUDIENCE_ENV]: FULL_ENV[BACKOFFICE_AUTH_AUDIENCE_ENV],
      },
    };

    for (const [missing, env] of Object.entries(partials)) {
      expect(backofficeAuthConfig(fakeEvent(env)), `missing: ${missing}`).toBeNull();
    }
  });

  it('treats an empty string as not configured', () => {
    // Giá trị rỗng là default build-time của biến chưa cấp secret — coi nó là
    // "đã cấu hình" là dựng authorize URL với issuer rỗng.
    expect(
      backofficeAuthConfig(fakeEvent({ ...FULL_ENV, [BACKOFFICE_AUTH_ISSUER_ENV]: '' })),
    ).toBeNull();
  });

  it('does not disclose which variable is missing', () => {
    // `null` là toàn bộ output của nhánh thiếu — không có shape nào phân biệt
    // "thiếu issuer" với "thiếu client id" cho caller dò luồng.
    const withoutIssuer = {
      [BACKOFFICE_AUTH_AUDIENCE_ENV]: FULL_ENV[BACKOFFICE_AUTH_AUDIENCE_ENV],
      [BACKOFFICE_AUTH_CLIENT_ID_ENV]: FULL_ENV[BACKOFFICE_AUTH_CLIENT_ID_ENV],
    };
    const withoutClientId = {
      [BACKOFFICE_AUTH_ISSUER_ENV]: FULL_ENV[BACKOFFICE_AUTH_ISSUER_ENV],
      [BACKOFFICE_AUTH_AUDIENCE_ENV]: FULL_ENV[BACKOFFICE_AUTH_AUDIENCE_ENV],
    };

    expect(backofficeAuthConfig(fakeEvent(withoutIssuer))).toBeNull();
    expect(backofficeAuthConfig(fakeEvent(withoutClientId))).toBeNull();
  });
});

describe('backofficeAuthConfig — env precedence and no-runtimeConfig path', () => {
  it('falls back to the Nitro private runtimeConfig when the Worker env is absent', () => {
    // Container Node local không có `env` của Worker — cấu hình nằm ở
    // runtimeConfig private (`backofficeAuthIssuer`...). Giả lập `useRuntimeConfig`
    // bằng global vì module gọi nó như một hàm tự do.
    vi.stubGlobal('useRuntimeConfig', () => ({
      backofficeAuthIssuer: 'https://auth.node.test',
      backofficeAuthAudience: 'https://api.node.test/backoffice',
      backofficeAuthClientId: 'backoffice-node',
    }));

    expect(backofficeAuthConfig(fakeEvent(undefined))).toEqual({
      issuer: 'https://auth.node.test',
      audience: 'https://api.node.test/backoffice',
      clientId: 'backoffice-node',
    });
  });

  it('prefers the Worker env over the runtimeConfig when both carry values', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      backofficeAuthIssuer: 'https://auth.node.test',
      backofficeAuthAudience: 'https://api.node.test/backoffice',
      backofficeAuthClientId: 'backoffice-node',
    }));

    expect(backofficeAuthConfig(fakeEvent(FULL_ENV))?.issuer).toBe('https://auth.test.ecoma.io');
  });

  it('returns null when neither source answers instead of throwing', () => {
    // Test dựng h3 app trực tiếp không có runtimeConfig: `useRuntimeConfig`
    // ném — nhánh đó phải là `null` (503 của caller), không phải một error
    // khác làm mất đúng phân loại "chưa cấu hình".
    vi.stubGlobal('useRuntimeConfig', () => {
      throw new Error('no runtime config outside nitro');
    });

    expect(backofficeAuthConfig(fakeEvent(undefined))).toBeNull();
  });
});
