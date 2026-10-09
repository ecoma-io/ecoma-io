import { describe, expect, it } from 'vitest';

import { parseHomeLocaleRoot } from './home-locale';

describe('parseHomeLocaleRoot', () => {
  it('chấp nhận /en và /vi đúng chuẩn', () => {
    expect(parseHomeLocaleRoot('/en')).toBe('en');
    expect(parseHomeLocaleRoot('/vi')).toBe('vi');
  });

  it('từ chối root `/` — `/` là locale-resolution entry point, không phải Home surface', () => {
    expect(parseHomeLocaleRoot('/')).toBeUndefined();
  });

  it('từ chối trailing slash, có segment sau, case khác, encoded lạ', () => {
    expect(parseHomeLocaleRoot('/en/')).toBeUndefined();
    expect(parseHomeLocaleRoot('/vi/')).toBeUndefined();
    expect(parseHomeLocaleRoot('/en/foo')).toBeUndefined();
    expect(parseHomeLocaleRoot('/EN')).toBeUndefined();
    expect(parseHomeLocaleRoot('/Vi')).toBeUndefined();
    expect(parseHomeLocaleRoot('/%65n')).toBeUndefined();
    expect(parseHomeLocaleRoot('/e%6E')).toBeUndefined();
  });

  it('từ chối prefix/suffix gây nhầm: //en, /%2Fen', () => {
    expect(parseHomeLocaleRoot('//en')).toBeUndefined();
    expect(parseHomeLocaleRoot('/%2Fen')).toBeUndefined();
  });

  it('từ chối /en/foo/bar, /vi/x', () => {
    expect(parseHomeLocaleRoot('/en/foo/bar')).toBeUndefined();
    expect(parseHomeLocaleRoot('/vi/x')).toBeUndefined();
  });

  it('locale không thuộc registry → undefined', () => {
    expect(parseHomeLocaleRoot('/fr')).toBeUndefined();
    expect(parseHomeLocaleRoot('/de')).toBeUndefined();
  });
});
