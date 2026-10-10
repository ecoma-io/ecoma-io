import { describe, expect, it } from 'vitest';

import { LEGAL_SLUGS } from './legal-content';
import { parseLegalPage } from './legal-locale';

describe('parseLegalPage', () => {
  it('chấp nhận mọi slug của LEGAL_SLUGS ở cả hai locale', () => {
    for (const slug of LEGAL_SLUGS) {
      expect(parseLegalPage(`/en/legal/${slug}`)).toEqual({ locale: 'en', slug });
      expect(parseLegalPage(`/vi/legal/${slug}`)).toEqual({ locale: 'vi', slug });
    }
  });

  it('từ chối root, locale-root và mount khác — chỉ đúng pathname legal', () => {
    expect(parseLegalPage('/')).toBeUndefined();
    expect(parseLegalPage('/en')).toBeUndefined();
    expect(parseLegalPage('/vi')).toBeUndefined();
    expect(parseLegalPage('/en/blog')).toBeUndefined();
    expect(parseLegalPage('/en/legal')).toBeUndefined();
  });

  it('từ chối slug ngoài tập — biến slug lạ thành 404, không fallback', () => {
    expect(parseLegalPage('/en/legal/unknown')).toBeUndefined();
    expect(parseLegalPage('/en/legal/')).toBeUndefined();
    expect(parseLegalPage('/vi/legal/terms/x')).toBeUndefined();
  });

  it('từ chối trailing slash, case khác, encoded lạ, double slash', () => {
    expect(parseLegalPage('/en/legal/privacy/')).toBeUndefined();
    expect(parseLegalPage('/en/Legal/privacy')).toBeUndefined();
    expect(parseLegalPage('/EN/legal/privacy')).toBeUndefined();
    expect(parseLegalPage('/%65n/legal/privacy')).toBeUndefined();
    expect(parseLegalPage('/en//legal/privacy')).toBeUndefined();
    expect(parseLegalPage('/en/legal//privacy')).toBeUndefined();
    expect(parseLegalPage('/en/legal/privacy?x=1')).toBeUndefined();
    expect(parseLegalPage('/en/legal/privacy#h')).toBeUndefined();
  });

  it('locale không thuộc registry → undefined', () => {
    expect(parseLegalPage('/fr/legal/privacy')).toBeUndefined();
    expect(parseLegalPage('/de/legal/terms')).toBeUndefined();
  });
});
