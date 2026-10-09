import { describe, expect, it } from 'vitest';

import { HOME_DEFAULT_LOCALE } from './default-locale';

describe('HOME_DEFAULT_LOCALE', () => {
  it('phải là "en"', () => {
    expect(HOME_DEFAULT_LOCALE).toBe('en');
  });
});
