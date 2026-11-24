import { describe, expect, it, vi } from 'vitest';

import { CreateMailMessageUseCase } from './create-mail-message';
import type { CreateMailMessageConfig, CreateMailMessageDeps } from './create-mail-message';
import type {
  MailMessageRepositoryPort,
  MailRateLimitStorePort,
  MailTemplateRepositoryPort,
} from '../ports';

function baseConfig(overrides: Partial<CreateMailMessageConfig> = {}): CreateMailMessageConfig {
  return {
    rateLimitPrincipal: { limit: 10, windowMs: 60_000 },
    rateLimitSystem: { limit: 1000, windowMs: 60_000 },
    rateLimitIdempotencyKey: { limit: 3, windowMs: 60_000 },
    fingerprintKeyring: {
      currentProfile: 'p1.k1',
      keysByProfile: new Map([['p1.k1', 'keyhex-1']]),
    },
    defaultLocale: 'en',
    maxRenderBytes: 100_000,
    nowMs: 1000,
    messageId: 'msg-1',
    outboxId: 'obx-1',
    deliveryId: 'dlv-1',
    principal: { id: 'principal-1', app: 'account' },
    idempotencyKey: 'key-1',
    request: {
      template: 'welcome',
      recipient: 'a@b.com',
      variables: {},
    },
    ...overrides,
  };
}

/** Fingerprint giả: digest thuần KHÔNG mang tag — usecase tự ghép tag khi persist. */
function fakeFingerprint(input: {
  keyHex: string;
  template: string;
  locale: string;
  recipient: string;
  variables: Record<string, unknown>;
}): Promise<string> {
  return Promise.resolve(
    `${Buffer.from(input.keyHex).toString('hex').slice(0, 8)}:${input.template}:${input.locale}:${input.recipient}:${JSON.stringify(input.variables)}`,
  );
}

function mockDeps(overrides: Partial<CreateMailMessageDeps> = {}): CreateMailMessageDeps {
  const messages: MailMessageRepositoryPort = {
    async findByIdempotencyKey() {
      return null;
    },
    async createWithOutbox() {
      return { kind: 'created', fingerprint: null };
    },
  };
  const templates: MailTemplateRepositoryPort = {
    async findActiveByNameAndLocale() {
      return [
        {
          id: 'tpl-1',
          name: 'welcome',
          locale: 'en',
          version: 1,
          subjectTemplate: 'Hi',
          bodyTemplate: 'Hello',
          variablesSchemaJson: '{"type":"object"}',
        },
      ];
    },
  };
  const rateLimits: MailRateLimitStorePort = {
    async tryConsume() {
      return { kind: 'allowed', hits: 1, windowStartedAtMs: 0 };
    },
  };
  return {
    messages,
    templates,
    rateLimits,
    logAlert: vi.fn<CreateMailMessageDeps['logAlert']>(),
    computeFingerprint: fakeFingerprint,
    hashIdempotencyKey: async (key) => `hash(${key})`,
    ...overrides,
  };
}

describe('CreateMailMessageUseCase — validation order (FR-001)', () => {
  it('step 1: invalid recipient rejected before rate limit and template lookup', async () => {
    const deps = mockDeps();
    const templatesSpy = vi.spyOn(deps.templates, 'findActiveByNameAndLocale');
    const rateSpy = vi.spyOn(deps.rateLimits, 'tryConsume');
    const useCase = new CreateMailMessageUseCase(deps);
    const result = await useCase.execute(
      baseConfig({ request: { template: 'welcome', recipient: 'a@b@c' } }),
    );
    expect(result).toEqual({ kind: 'invalid', field: 'recipient' });
    expect(rateSpy).not.toHaveBeenCalled();
    expect(templatesSpy).not.toHaveBeenCalled();
  });

  it('step 2: replay matched by fingerprint returns replay, never rate limited', async () => {
    // Row đã persist mang tag — format `<profileTag>:<digest>` (FR-002 keyring).
    const stored = `p1.k1:${await fakeFingerprint({
      keyHex: 'keyhex-1',
      template: 'welcome',
      locale: 'en',
      recipient: 'a@b.com',
      variables: {},
    })}`;
    const deps = mockDeps({
      messages: {
        async findByIdempotencyKey() {
          return { requestFingerprint: stored };
        },
        async createWithOutbox() {
          throw new Error('must not write on replay');
        },
      },
    });
    const rateSpy = vi.spyOn(deps.rateLimits, 'tryConsume');
    const templatesSpy = vi.spyOn(deps.templates, 'findActiveByNameAndLocale');
    const useCase = new CreateMailMessageUseCase(deps);
    const result = await useCase.execute(baseConfig());
    expect(result).toEqual({ kind: 'replay' });
    expect(rateSpy).not.toHaveBeenCalled();
    expect(templatesSpy).not.toHaveBeenCalled();
  });

  it('step 2: fingerprint mismatch consumes key-scoped counter then conflict', async () => {
    const deps = mockDeps({
      messages: {
        async findByIdempotencyKey() {
          return { requestFingerprint: 'p1.k1:different' };
        },
        async createWithOutbox() {
          throw new Error('unreachable');
        },
      },
    });
    const useCase = new CreateMailMessageUseCase(deps);
    const result = await useCase.execute(baseConfig());
    expect(result).toEqual({ kind: 'conflict' });
    expect(deps.logAlert).toHaveBeenCalledOnce();
  });

  it('step 3: principal denied before system — system counter untouched', async () => {
    const consumedScopes: string[] = [];
    const deps = mockDeps({
      rateLimits: {
        async tryConsume(input: { scope: string; limit: number; windowMs: number; nowMs: number }) {
          consumedScopes.push(input.scope);
          return input.scope === 'system'
            ? { kind: 'allowed', hits: 1, windowStartedAtMs: 0 }
            : { kind: 'denied', hits: 11, windowStartedAtMs: 0 };
        },
      },
    });
    const useCase = new CreateMailMessageUseCase(deps);
    const result = await useCase.execute(baseConfig());
    expect(result).toEqual({ kind: 'rate-limited', retryAfterMs: 59_000 });
    expect(consumedScopes).toEqual([`principal:principal-1`]);
  });

  it('step 4: template fallback to default locale once, highest version wins', async () => {
    const queries: string[] = [];
    const deps = mockDeps({
      templates: {
        async findActiveByNameAndLocale(_name: string, locale: string) {
          queries.push(locale);
          if (locale === 'vi') {
            return [];
          }
          return [
            {
              id: 'tpl-2',
              name: 'welcome',
              locale: 'en',
              version: 3,
              subjectTemplate: 'Hi v3',
              bodyTemplate: 'Hello',
              variablesSchemaJson: '{"type":"object"}',
            },
            {
              id: 'tpl-1',
              name: 'welcome',
              locale: 'en',
              version: 2,
              subjectTemplate: 'Hi v2',
              bodyTemplate: 'Hello',
              variablesSchemaJson: '{"type":"object"}',
            },
          ];
        },
      },
    });
    const messagesSpy = vi.spyOn(deps.messages, 'createWithOutbox');
    const useCase = new CreateMailMessageUseCase(deps);
    const result = await useCase.execute(
      baseConfig({ request: { template: 'welcome', recipient: 'a@b.com', locale: 'vi' } }),
    );
    expect(result).toEqual({ kind: 'created' });
    expect(queries).toEqual(['vi', 'en']);
    expect(messagesSpy).toHaveBeenCalledOnce();
    expect(messagesSpy.mock.calls[0][0].templateVersion).toBe(3);
  });

  it('step 5: schema validation rejects wrong types without coercion', async () => {
    const deps = mockDeps({
      templates: {
        async findActiveByNameAndLocale() {
          return [
            {
              id: 'tpl-1',
              name: 'welcome',
              locale: 'en',
              version: 1,
              subjectTemplate: 'Hi {{name}}',
              bodyTemplate: 'Hello {{name}}',
              variablesSchemaJson:
                '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
            },
          ];
        },
      },
    });
    const useCase = new CreateMailMessageUseCase(deps);
    // `1` khác `"1"` — không tự ép kiểu.
    const result = await useCase.execute(
      baseConfig({
        request: { template: 'welcome', recipient: 'a@b.com', variables: { name: 1 } },
      }),
    );
    expect(result).toEqual({ kind: 'invalid', field: 'variables' });
  });

  it('step 5: payload too large rejected before write', async () => {
    const deps = mockDeps();
    const writeSpy = vi.spyOn(deps.messages, 'createWithOutbox');
    const useCase = new CreateMailMessageUseCase(deps);
    const result = await useCase.execute(baseConfig({ maxRenderBytes: 1 }));
    expect(result).toEqual({ kind: 'payload-too-large' });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('step 6: already-exists re-reads winner and compares against fresh row', async () => {
    const stored = `p1.k1:${await fakeFingerprint({
      keyHex: 'keyhex-1',
      template: 'welcome',
      locale: 'en',
      recipient: 'a@b.com',
      variables: {},
    })}`;
    let readCount = 0;
    const deps = mockDeps({
      messages: {
        async findByIdempotencyKey() {
          readCount += 1;
          // Lần 1 (lookup trước): null. Lần 2 (sau already-exists): row winner.
          return readCount === 1 ? null : { requestFingerprint: stored };
        },
        async createWithOutbox() {
          return { kind: 'already-exists' };
        },
      },
    });
    const useCase = new CreateMailMessageUseCase(deps);
    const result = await useCase.execute(baseConfig());
    expect(result).toEqual({ kind: 'replay' });
    expect(readCount).toBe(2);
  });

  it('keyring missing current profile fails fast, never falls back to bare hash', async () => {
    const useCase = new CreateMailMessageUseCase(mockDeps());
    await expect(
      useCase.execute(
        baseConfig({
          fingerprintKeyring: { currentProfile: 'p1.k9', keysByProfile: new Map([['p1.k1', 'x']]) },
        }),
      ),
    ).rejects.toThrow('fingerprint keyring missing current profile');
  });

  it('unknown stored tag → service-unavailable, not conflict', async () => {
    const deps = mockDeps({
      messages: {
        async findByIdempotencyKey() {
          return { requestFingerprint: 'p9.k9:abc' };
        },
        async createWithOutbox() {
          throw new Error('unreachable');
        },
      },
    });
    const useCase = new CreateMailMessageUseCase(deps);
    const result = await useCase.execute(baseConfig());
    expect(result).toEqual({ kind: 'service-unavailable' });
  });

  it('invalid idempotency key shape rejected', async () => {
    const useCase = new CreateMailMessageUseCase(mockDeps());
    const result = await useCase.execute(baseConfig({ idempotencyKey: '' }));
    expect(result).toEqual({ kind: 'invalid', field: 'idempotency_key' });
  });

  it('empty variables and missing variables are the same business request', async () => {
    // Cùng fingerprint helper → cùng fingerprint → cùng kết quả created.
    const depsA = mockDeps();
    const depsB = mockDeps();
    const useCaseA = new CreateMailMessageUseCase(depsA);
    const useCaseB = new CreateMailMessageUseCase(depsB);
    const rA = await useCaseA.execute(
      baseConfig({ request: { template: 'welcome', recipient: 'a@b.com' } }),
    );
    const rB = await useCaseB.execute(
      baseConfig({ request: { template: 'welcome', recipient: 'a@b.com', variables: {} } }),
    );
    expect(rA).toEqual(rB);
  });
});
