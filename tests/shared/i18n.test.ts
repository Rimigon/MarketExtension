import { describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '@/shared/i18n';

describe('i18n', () => {
  it('returns the RU string for a known key by default', () => {
    setLocale('ru');
    expect(t('common.save')).toBe('Сохранить');
    expect(getLocale()).toBe('ru');
  });

  it('falls back to RU when an unsupported locale is set', () => {
    setLocale('en');
    // EN pack currently mirrors RU until we ship the V2 EN translations.
    expect(t('common.save')).toBe('Сохранить');
    setLocale('ru');
  });

  it('substitutes named parameters', () => {
    expect(t('list.foundOf', { found: 5, total: 12 })).toBe('Найдено: 5 из 12');
  });

  it('leaves unknown placeholders as-is', () => {
    expect(t('list.foundOf', { found: 5 })).toBe('Найдено: 5 из {total}');
  });
});
