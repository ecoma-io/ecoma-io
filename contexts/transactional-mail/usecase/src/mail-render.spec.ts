import { describe, expect, it } from 'vitest';

import { renderMail } from './mail-render';

describe('renderMail', () => {
  it('interpolates variables in subject and body', () => {
    const r = renderMail({
      subjectTemplate: 'Hi {{name}}',
      bodyTemplate: 'Hello {{name}}, <b>{{role}}</b>',
      variables: { name: 'An', role: 'admin' },
    });
    expect(r).toEqual({ ok: true, subject: 'Hi An', body: 'Hello An, <b>admin</b>' });
  });

  it('HTML-escapes body once, subject not HTML-escaped (header MIME context)', () => {
    const r = renderMail({
      subjectTemplate: 'R&D {{x}}',
      bodyTemplate: '{{x}}',
      variables: { x: '<script>' },
    });
    if (!r.ok) throw new Error('unreachable');
    expect(r.subject).toBe('R&D <script>');
    expect(r.body).toBe('&lt;script&gt;');
  });

  it('value containing {{ }} is not re-rendered (single pass)', () => {
    const r = renderMail({
      subjectTemplate: '{{x}}',
      bodyTemplate: '{{x}}',
      variables: { x: '{{y}}' },
    });
    if (!r.ok) throw new Error('unreachable');
    expect(r.subject).toBe('{{y}}');
    expect(r.body).toBe('{{y}}');
  });

  it('missing variable renders empty', () => {
    const r = renderMail({
      subjectTemplate: 'Hi {{missing}}!',
      bodyTemplate: 'x',
      variables: {},
    });
    if (!r.ok) throw new Error('unreachable');
    expect(r.subject).toBe('Hi !');
  });

  it('CR/LF or control character in subject rejected', () => {
    expect(renderMail({ subjectTemplate: 'a\nb', bodyTemplate: 'x', variables: {} }).ok).toBe(
      false,
    );
    expect(renderMail({ subjectTemplate: 'a\u0007b', bodyTemplate: 'x', variables: {} }).ok).toBe(
      false,
    );
  });
});
