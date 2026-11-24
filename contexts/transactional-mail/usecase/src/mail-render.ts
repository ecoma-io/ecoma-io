/**
 * Helper render template đơn giản: thay `{{key}}` bằng giá trị biến đã validate.
 *
 * Subject: KHÔNG HTML-escape (đi vào header MIME, không có ngữ cảnh HTML) — chỉ
 * chặn control character. Body: HTML-escape đúng một lần theo output context.
 * Biến chứa `{{ ... }}` không được render lại lần hai (giá trị biến được escape
 * trước khi chèn, nên chuỗi `{{` trong giá trị sẽ xuất hiện nguyên văn).
 */

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Kết quả render. */
export type MailRenderResult =
  | { readonly ok: true; readonly subject: string; readonly body: string }
  | { readonly ok: false; readonly reason: 'subject_control_character' };

/** Có ký tự control cấm trong subject (header MIME): CR/LF cấm (header injection),
 *  tab cho phép. Loop code point, không control-regex. */
function subjectHasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const cp = value.codePointAt(i) ?? 0;
    if ((cp < 0x20 && cp !== 0x09) || cp === 0x7f) {
      return true;
    }
  }
  return false;
}

export function renderMail(args: {
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  readonly variables: Record<string, unknown>;
}): MailRenderResult {
  const subject = interpolate(args.subjectTemplate, args.variables, false);
  const body = interpolate(args.bodyTemplate, args.variables, true);
  if (subjectHasControlCharacter(subject)) {
    return { ok: false, reason: 'subject_control_character' };
  }
  return { ok: true, subject, body };
}

function interpolate(
  template: string,
  variables: Record<string, unknown>,
  htmlEscape: boolean,
): string {
  return template.replace(/\{\{([^{}]+)\}\}/g, (_match, key) => {
    const cleanKey = key.trim();
    const value = Object.prototype.hasOwnProperty.call(variables, cleanKey)
      ? variables[cleanKey]
      : undefined;
    if (value === undefined || value === null) {
      return '';
    }
    const text = String(value);
    return htmlEscape ? escapeHtml(text) : text;
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (ch) => HTML_ESCAPE[ch] ?? ch);
}
