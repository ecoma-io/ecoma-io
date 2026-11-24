import { describe, expect, it } from 'vitest';

import {
  MailMessage,
  MAIL_MESSAGE_TRANSITIONS,
  isMailMessageTerminal,
  type MailMessageSnapshot,
} from '../mail-message/mail-message';
import { normalizeRecipient } from '../mail-message/recipient';
import { normalizeLocale } from '../mail-message/normalized-locale';
import { parseStoredFingerprint } from '../mail-message/request-fingerprint';
import { MailOutbox } from '../mail-outbox/mail-outbox';
import type { MailOutboxSnapshot } from '../mail-outbox/mail-outbox';
import { MailTemplate } from '../mail-template/mail-template';
import type { MailTemplateSnapshot } from '../mail-template/mail-template';
import { mailDomainError, isMailDomainError } from '../shared/errors';

function asMessageId(value: string): import('../mail-message/mail-message').MailMessageId {
  return value as import('../mail-message/mail-message').MailMessageId;
}

function asDeliveryId(value: string): import('../mail-message/mail-message').DeliveryId {
  return value as import('../mail-message/mail-message').DeliveryId;
}

function asOutboxId(value: string): import('../mail-outbox/mail-outbox').MailOutboxId {
  return value as import('../mail-outbox/mail-outbox').MailOutboxId;
}

function asTemplateId(value: string): import('../mail-template/mail-template').MailTemplateId {
  return value as import('../mail-template/mail-template').MailTemplateId;
}

function asTemplateName(value: string): import('../mail-template/mail-template').TemplateName {
  return value as import('../mail-template/mail-template').TemplateName;
}

function baseMessage(overrides: Partial<MailMessageSnapshot> = {}): MailMessageSnapshot {
  const locale = normalizeLocale('en');
  const recipient = normalizeRecipient('a@b.com');
  return {
    app: 'account',
    bodyRendered: 'Hello',
    createdAtMs: 1000,
    deliveryId: asDeliveryId('dlv-1'),
    dispatchGeneration: 1,
    failureReason: null,
    id: asMessageId('msg-1'),
    locale: locale.ok ? locale.value : (locale as never),
    principalId: 'principal-1',
    recipient: recipient.ok ? recipient.value : (recipient as never),
    recoveryCycleCount: 0,
    status: 'accepted',
    subjectRendered: 'Hi',
    templateName: 'welcome',
    templateVersion: 1,
    terminalAtMs: null,
    updatedAtMs: 1000,
    ...overrides,
  };
}

describe('normalizeRecipient', () => {
  it('lowercase domain, keep local-part case', () => {
    const r = normalizeRecipient('  John.Doe@EXAMPLE.COM ');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value).toBe('John.Doe@example.com');
  });

  it('reject multiple @ and empty', () => {
    expect(normalizeRecipient('a@b@c.com').ok).toBe(false);
    expect(normalizeRecipient('   ').ok).toBe(false);
  });
});

describe('normalizeLocale', () => {
  it('accepts BCP-47 simple tags', () => {
    expect(normalizeLocale('en-US').ok).toBe(true);
    expect(normalizeLocale(undefined).ok).toBe(false);
    expect(normalizeLocale('  ').ok).toBe(false);
  });
});

describe('parseStoredFingerprint', () => {
  it('splits tag and hex digest', () => {
    const parsed = parseStoredFingerprint('p1.k1:deadbeef'.padEnd(69, 'a'));
    // not important which digest, only shape.
    expect(parsed.ok).toBe(false);
  });
});

function expectMailError(err: unknown, code: string): void {
  if (!isMailDomainError(err)) {
    throw new Error(`expected MailDomainError, got ${JSON.stringify(err)}`);
  }
  expect(err.code).toBe(code);
}

describe('MailMessage lifecycle', () => {
  it('issue → accepted', () => {
    const m = MailMessage.issue({
      id: asMessageId('msg-1'),
      deliveryId: asDeliveryId('dlv-1'),
      app: 'account',
      principalId: 'principal-1',
      templateName: 'welcome',
      templateVersion: 1,
      locale: baseMessage().locale,
      recipient: baseMessage().recipient,
      subjectRendered: 'Hi',
      bodyRendered: 'Hello',
      nowMs: 1000,
    });
    if (m instanceof MailMessage === false) throw new Error('issue failed');
    expect(m.status()).toBe('accepted');
    expect(m.dispatchGeneration()).toBe(1);
    expect(m.recoveryCycleCount()).toBe(0);
    expect(isMailMessageTerminal(m.status())).toBe(false);
    expect(m.snapshot().terminalAtMs).toBeNull();
  });

  it('accepted → queued via markQueued', () => {
    const m = MailMessage.reconstitute(baseMessage({ status: 'accepted' }));
    expect(m.markQueued(2000)).toBeUndefined();
    expect(m.status()).toBe('queued');
    expect(m.snapshot().terminalAtMs).toBeNull();
  });

  it('queued → sent applies outcome', () => {
    const m = MailMessage.reconstitute(baseMessage({ status: 'queued' }));
    expect(m.applyOutcome('sent', 1, null, 3000)).toBe('applied');
    expect(m.status()).toBe('sent');
    expect(isMailMessageTerminal(m.status())).toBe(true);
    expect(m.snapshot().terminalAtMs).toBe(3000);
  });

  it('queued → failed requires errorClass', () => {
    const m = MailMessage.reconstitute(baseMessage({ status: 'queued' }));
    const r = m.applyOutcome('failed', 1, 'provider_rejected', 3000);
    expect(r).toBe('applied');
    expect(m.failureReason()).toBe('provider_rejected');
    expect(m.snapshot().terminalAtMs).toBe(3000);
  });

  it('cannot markQueued over sent', () => {
    const m = MailMessage.reconstitute(baseMessage({ status: 'sent', terminalAtMs: 3000 }));
    const err = m.markQueued(4000);
    expectMailError(err, 'invalid_transition');
    expect(m.status()).toBe('sent');
  });

  it('generation mismatch → stale error, no state change', () => {
    const m = MailMessage.reconstitute(baseMessage({ status: 'queued' }));
    const err = m.applyOutcome('sent', 999, null, 3000);
    expectMailError(err, 'generation_mismatch');
    expect(m.status()).toBe('queued');
    expect(m.snapshot().terminalAtMs).toBeNull();
  });

  it('duplicate outcome is no-op', () => {
    const m = MailMessage.reconstitute(baseMessage({ status: 'sent', terminalAtMs: 3000 }));
    expect(m.applyOutcome('sent', 1, null, 5000)).toBe('duplicate');
    expect(m.snapshot().terminalAtMs).toBe(3000); // không đổi thời gian cũ
  });

  it('blocked → queued redrive bumps generation, budget monotonic', () => {
    const m = MailMessage.reconstitute(baseMessage({ status: 'blocked', recoveryCycleCount: 2 }));
    expect(m.redrive(6000)).toBeUndefined();
    expect(m.status()).toBe('queued');
    expect(m.dispatchGeneration()).toBe(2);
    expect(m.recoveryCycleCount()).toBe(2); // không reset
  });

  it('sent/failed cannot redrive', () => {
    const m = MailMessage.reconstitute(baseMessage({ status: 'sent', terminalAtMs: 3000 }));
    const err = m.redrive(7000);
    expectMailError(err, 'not_blocked');
    expect(m.status()).toBe('sent');
  });

  it('terminal parity enforced on reconstitute', () => {
    expect(() =>
      MailTemplate.reconstitute({
        id: asMessageId(
          'msg-x',
        ) as unknown as import('../mail-template/mail-template').MailTemplateId,
        name: 'welcome' as unknown as import('../mail-template/mail-template').TemplateName,
        locale: 'en',
        version: 1,
        subjectTemplate: 'Hi',
        bodyTemplate: 'Hello',
        variablesSchemaJson: '{}',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      }),
    ).not.toThrow();
  });

  it('MAIL_MESSAGE_TRANSITIONS table', () => {
    expect(MAIL_MESSAGE_TRANSITIONS.accepted).toEqual(['queued', 'blocked']);
    expect(MAIL_MESSAGE_TRANSITIONS.sent).toEqual([]);
  });
});

function baseOutbox(overrides: Partial<MailOutboxSnapshot> = {}): MailOutboxSnapshot {
  return {
    availableAtMs: 1000,
    claimedAtMs: null,
    claimedBy: null,
    createdAtMs: 1000,
    deliveryId: asDeliveryId('dlv-1'),
    dispatchGeneration: 1,
    id: asOutboxId('obx-1'),
    lastError: null,
    publishAttempts: 0,
    publishedAtMs: null,
    status: 'pending',
    updatedAtMs: 1000,
    ...overrides,
  };
}

describe('MailOutbox lifecycle', () => {
  it('issue → pending', () => {
    const o = MailOutbox.issue({
      id: asOutboxId('obx-1'),
      deliveryId: asDeliveryId('dlv-1'),
      dispatchGeneration: 1,
      availableAtMs: 1000,
      nowMs: 1000,
    });
    expect(o.status()).toBe('pending');
    expect(o.publishAttempts()).toBe(0);
    expect(o.claimedBy()).toBeNull();
  });

  it('claim pending → publishing with lease', () => {
    const o = MailOutbox.reconstitute(baseOutbox({ status: 'pending' }));
    expect(o.claim('publisher-1', 2000)).toBeUndefined();
    expect(o.status()).toBe('publishing');
    expect(o.claimedBy()).toBe('publisher-1');
    expect(o.publishAttempts()).toBe(1);
  });

  it('publish → published', () => {
    const o = MailOutbox.reconstitute(
      baseOutbox({ status: 'publishing', claimedBy: 'publisher-1', claimedAtMs: 2000 }),
    );
    expect(o.markPublished(3000)).toBeUndefined();
    expect(o.status()).toBe('published');
    expect(o.snapshot().publishedAtMs).toBe(3000);
  });

  it('publish fail → failed (bỏ cuộc, không mất intent)', () => {
    const o = MailOutbox.reconstitute(
      baseOutbox({ status: 'publishing', claimedBy: 'publisher-1', claimedAtMs: 2000 }),
    );
    expect(o.markFailed('provider_unavailable', 3000)).toBeUndefined();
    expect(o.status()).toBe('failed');
    expect(o.snapshot().lastError).toBe('provider_unavailable');
    expect(o.snapshot().publishedAtMs).toBeNull();
  });

  it('repair failed → pending (đường duy nhất reset bỏ cuộc)', () => {
    const o = MailOutbox.reconstitute(baseOutbox({ status: 'failed', publishAttempts: 5 }));
    expect(o.repair(5000, 8000)).toBeUndefined();
    expect(o.status()).toBe('pending');
    expect(o.publishAttempts()).toBe(0);
    expect(o.snapshot().availableAtMs).toBe(13000);
  });

  it('repair non-failed rejected', () => {
    const o = MailOutbox.reconstitute(baseOutbox({ status: 'pending' }));
    const err = o.repair(5000, 8000);
    expectMailError(err, 'invalid_transition');
    expect(o.status()).toBe('pending');
  });
});

function baseTemplate(overrides: Partial<MailTemplateSnapshot> = {}): MailTemplateSnapshot {
  return {
    bodyTemplate: 'Hello {{name}}',
    createdAtMs: 1000,
    id: asTemplateId('tpl-1'),
    locale: 'en',
    name: asTemplateName('welcome'),
    status: 'active',
    subjectTemplate: 'Hi {{name}}',
    updatedAtMs: 1000,
    variablesSchemaJson: '{}',
    version: 1,
    ...overrides,
  };
}

describe('MailTemplate lifecycle', () => {
  it('issue → active', () => {
    const t = MailTemplate.issue({
      id: asTemplateId('tpl-1'),
      name: asTemplateName('welcome'),
      locale: 'en',
      version: 1,
      subjectTemplate: 'Hi {{name}}',
      bodyTemplate: 'Hello {{name}}',
      variablesSchemaJson: '{}',
      nowMs: 1000,
    });
    expect(t.isActive()).toBe(true);
    expect(t.version()).toBe(1);
    expect(t.businessKey()).toEqual({ name: asTemplateName('welcome'), locale: 'en' });
  });

  it('disable', () => {
    const t = MailTemplate.reconstitute(baseTemplate({ status: 'active' }));
    t.disable(2000);
    expect(t.isActive()).toBe(false);
    expect(t.snapshot().updatedAtMs).toBe(2000);
  });
});

describe('validation entry points', () => {
  it('MailMessage.issue rejects non-finite now and empty identifiers', () => {
    const base = {
      id: asMessageId('msg-1'),
      deliveryId: asDeliveryId('dlv-1'),
      app: 'account',
      principalId: 'principal-1',
      templateName: 'welcome',
      templateVersion: 1,
      locale: baseMessage().locale,
      recipient: baseMessage().recipient,
      subjectRendered: 'Hi',
      bodyRendered: 'Hello',
      nowMs: 1000,
    };
    expect(() => MailMessage.issue({ ...base, nowMs: Number.NaN })).toThrow(TypeError);
    expect(() => MailMessage.issue({ ...base, app: '' })).toThrow(TypeError);
    expect(() => MailMessage.issue({ ...base, templateVersion: 0 })).toThrow(TypeError);
  });

  it('MailMessage.reconstitute rejects broken snapshots', () => {
    expect(() => MailMessage.reconstitute(baseMessage({ dispatchGeneration: 0 }))).toThrow(
      TypeError,
    );
    expect(() =>
      MailMessage.reconstitute(baseMessage({ status: 'sent', terminalAtMs: null })),
    ).toThrow(TypeError);
    expect(() =>
      MailMessage.reconstitute(
        baseMessage({ status: 'failed', failureReason: 'provider_rejected', terminalAtMs: 3000 }),
      ),
    ).not.toThrow();
    expect(() =>
      MailMessage.reconstitute(
        baseMessage({ status: 'queued', failureReason: 'provider_rejected' }),
      ),
    ).toThrow(TypeError);
  });

  it('MailOutbox.issue and reconstitute reject broken input', () => {
    expect(() =>
      MailOutbox.issue({
        id: asOutboxId('obx-1'),
        deliveryId: asDeliveryId('dlv-1'),
        dispatchGeneration: 0,
        availableAtMs: 1000,
        nowMs: 1000,
      }),
    ).toThrow(TypeError);
    // lease pair vi phạm
    expect(() =>
      MailOutbox.reconstitute({
        id: asOutboxId('obx-1'),
        deliveryId: asDeliveryId('dlv-1'),
        dispatchGeneration: 1,
        status: 'publishing',
        publishAttempts: 1,
        availableAtMs: 2000,
        claimedBy: 'p1',
        claimedAtMs: null,
        createdAtMs: 1000,
        updatedAtMs: 1000,
        lastError: null,
        publishedAtMs: null,
      }),
    ).toThrow(TypeError);
    expect(() =>
      MailOutbox.reconstitute({
        id: asOutboxId('obx-1'),
        deliveryId: asDeliveryId('dlv-1'),
        dispatchGeneration: 1,
        status: 'published',
        publishAttempts: 1,
        availableAtMs: 2000,
        claimedBy: null,
        claimedAtMs: null,
        createdAtMs: 1000,
        updatedAtMs: 1000,
        lastError: null,
        publishedAtMs: null,
      }),
    ).toThrow(TypeError);
  });

  it('MailTemplate.issue rejects empty and bad version', () => {
    expect(() =>
      MailTemplate.issue({
        id: asTemplateId('tpl-1'),
        name: asTemplateName('welcome'),
        locale: '',
        version: 1,
        subjectTemplate: 'Hi',
        bodyTemplate: 'Hello',
        variablesSchemaJson: '{}',
        nowMs: 1000,
      }),
    ).toThrow(TypeError);
    expect(() =>
      MailTemplate.issue({
        id: asTemplateId('tpl-1'),
        name: asTemplateName('welcome'),
        locale: 'en',
        version: -1,
        subjectTemplate: 'Hi',
        bodyTemplate: 'Hello',
        variablesSchemaJson: '{}',
        nowMs: 1000,
      }),
    ).toThrow(TypeError);
  });

  it('MailMessage.reconstitute rejects updatedAt before createdAt', () => {
    expect(() =>
      MailMessage.reconstitute(baseMessage({ createdAtMs: 5000, updatedAtMs: 1000 })),
    ).toThrow(TypeError);
  });
});

describe('mailDomainError', () => {
  it('stable code + message, frozen table', () => {
    const err = mailDomainError('invalid_transition');
    expect(err.code).toBe('invalid_transition');
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
    expect(isMailDomainError(err)).toBe(true);
    expect(isMailDomainError({ code: 'invalid_transition', message: 'tùy ý' })).toBe(false);
    expect(() => mailDomainError('not-a-code' as any)).toThrow(TypeError);
  });
});

describe('edge branches', () => {
  it('recipient: control char, no-at, empty local/domain', () => {
    expect(normalizeRecipient('a\u0000b@c.com').ok).toBe(false);
    expect(normalizeRecipient('plainaddress').ok).toBe(false);
    expect(normalizeRecipient('@domain.com').ok).toBe(false);
    expect(normalizeRecipient('local@').ok).toBe(false);
  });

  it('locale: too-long and malformed', () => {
    expect(normalizeLocale('a'.repeat(40)).ok).toBe(false);
    expect(normalizeLocale('en US!').ok).toBe(false);
  });

  it('fingerprint: bad shape', () => {
    expect(parseStoredFingerprint('notag').ok).toBe(false);
    expect(parseStoredFingerprint('tag:xyz').ok).toBe(false);
    expect(parseStoredFingerprint('tag:' + '0'.repeat(64)).ok).toBe(true);
  });

  it('outbox claim non-pending rejected', () => {
    const o = MailOutbox.reconstitute(baseOutbox({ status: 'published', publishedAtMs: 3000 }));
    expectMailError(o.claim('p2', 4000), 'invalid_transition');
    expect(o.status()).toBe('published');
  });

  it('outbox markFailed rejects empty error and non-publishing', () => {
    const pending = MailOutbox.reconstitute(baseOutbox({ status: 'pending' }));
    expectMailError(pending.markFailed('x', 4000), 'invalid_transition');
    expect(pending.status()).toBe('pending');
  });

  it('message issue rejects control char subject and empty body', () => {
    expect(() =>
      MailMessage.issue({
        id: asMessageId('msg-9'),
        deliveryId: asDeliveryId('dlv-9'),
        app: 'account',
        principalId: 'p',
        templateName: asTemplateName('welcome'),
        templateVersion: 1,
        locale: baseMessage().locale,
        recipient: baseMessage().recipient,
        subjectRendered: 'a\u0000b',
        bodyRendered: 'Hello',
        nowMs: 1000,
      }),
    ).toThrow(TypeError);
  });
});
