import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_VUE = resolve(import.meta.dirname, '../app/app.vue');
const APP_VUE_SOURCE = readFileSync(APP_VUE, 'utf8');
const APP_VUE_CODE = APP_VUE_SOURCE.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(
  /\/\/[^\n]*/gu,
  '',
);

function returnedObjectOf(code: string): string {
  const match = /return\s*\{/u.exec(code);
  if (match === null) {
    return '';
  }

  const start = code.indexOf('{', match.index);
  let depth = 0;

  for (let index = start; index < code.length; index += 1) {
    if (code[index] === '{') {
      depth += 1;
    } else if (code[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return code.slice(start, index + 1);
      }
    }
  }

  return '';
}

describe('lang trên <html> do app sở hữu', () => {
  it('app.vue đặt lang, không chỉ dựa vào shell', () => {
    expect(APP_VUE_CODE).toMatch(/\blang\s*:/u);
    expect(APP_VUE_CODE).not.toMatch(/\blang\s*:\s*'en'/u);
  });

  it('lang là một phần của htmlAttrs gộp cùng shell, không phải useHead thứ hai', () => {
    expect(APP_VUE_CODE).toMatch(/htmlAttrs\s*:\s*\{[^}]*\blang\s*:/u);
    expect(APP_VUE_CODE).toMatch(/\.\.\.htmlAttrs\b/u);
  });

  it('vẫn truyền bodyAttrs của shell sang useHead', () => {
    const returned = returnedObjectOf(APP_VUE_CODE);
    expect(returned).toMatch(/htmlAttrs\s*:/u);
    expect(returned).toMatch(/\bbodyAttrs\b/u);
    expect(APP_VUE_CODE).toMatch(/appShellHeadAttributes\(/u);
  });
});
