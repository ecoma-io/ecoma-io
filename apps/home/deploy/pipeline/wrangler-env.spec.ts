import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Bất biến cấu hình Wrangler cho pipeline delivery của Home (task §5).
 *
 * Các test này đọc trực tiếp `wrangler.jsonc` thay vì gọi Wrangler (dry-run
 * đã chạy riêng trong validation của PR): chúng chốt **cấu trúc** mà pipeline
 * dựa vào — tên Worker mỗi env, route domain, và `vars` chỉ tồn tại ở
 * staging — để một chỉnh sửa config tương lai không vô tình phá gates.
 */

/** Xoá comment dòng và block comment khỏi JSONC mà tôn trọng string literal. */
function stripJsoncComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++; // nhảy past '/' của '*/'
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * JSONC cho phép trailing comma, JSON.parse thì không — bỏ dấu phẩy ngay
 * trước `}`/`]` (ngoài string literal, đã được strip trước bước này).
 */
function stripTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/gu, '$1');
}

function loadWranglerConfig(): Record<string, unknown> {
  const path = resolve(process.cwd(), 'wrangler.jsonc');
  return JSON.parse(stripTrailingCommas(stripJsoncComments(readFileSync(path, 'utf8'))));
}

describe('wrangler.jsonc env separation', () => {
  const config = loadWranglerConfig();

  it('cả hai env được khai tường minh — staging và production', () => {
    const envs = config.env as Record<string, unknown>;
    expect(Object.keys(envs).toSorted()).toEqual(['production', 'staging']);
  });

  it('staging là Worker `stg-ecoma-home` trên zone `ecoma.io.vn`', () => {
    const staging = (config.env as Record<string, never>)['staging' as never];
    expect((staging as { name?: string }).name).toBe('stg-ecoma-home');
    const routes = (staging as { routes?: Array<{ pattern?: string }> }).routes ?? [];
    expect(routes.some((r) => r.pattern === 'ecoma.io.vn')).toBe(true);
  });

  it('production là Worker `ecoma-home` trên zone `ecoma.io`', () => {
    const production = (config.env as Record<string, never>)['production' as never];
    expect((production as { name?: string }).name).toBe('ecoma-home');
    const routes = (production as { routes?: Array<{ pattern?: string }> }).routes ?? [];
    expect(routes.some((r) => r.pattern === 'ecoma.io')).toBe(true);
  });

  it('staging mang var noindex; production không có `vars` nào', () => {
    const envs = config.env as Record<string, { vars?: Record<string, string> }>;
    expect(envs['staging']?.vars?.['NITRO_PUBLIC_NO_INDEX']).toBe('true');
    expect(envs['production']?.vars).toBeUndefined();
  });

  it('deploy không env không trỏ vào worker nào — Nx target bắt buộc configuration', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      nx?: {
        targets?: {
          deploy?: {
            options?: { command?: string };
            configurations?: Record<string, { command?: string }>;
          };
        };
      };
    };
    const deploy = pkg.nx?.targets?.deploy;
    // Lệnh mặc định phải từ chối chạy (exit 1), không phải deploy ngầm env nào.
    expect(deploy?.options?.command).toContain('exit 1');
    expect(deploy?.options?.command).not.toContain('wrangler deploy');
    // Hai configuration phải pin env Wrangler tường minh.
    expect(deploy?.configurations?.staging?.command).toContain('--env staging');
    expect(deploy?.configurations?.production?.command).toContain('--env production');
  });

  it('top-level config không chứa secret: mọi giá trị đều là config public', () => {
    // Phòng thủ nhẹ (task §5: secrets không bao giờ nằm trong JSONC). Quét
    // heuristic trên chuỗi file: API token Cloudflare có dạng dài 40 ký tự
    // alphanumeric — không được xuất hiện literal nào như vậy.
    const raw = readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8');
    expect(raw).not.toMatch(/[A-Za-z0-9_-]{40,}/u);
  });
});
