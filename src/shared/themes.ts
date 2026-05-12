import type { ThemeId } from './types';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  variant: 'light' | 'dark';
  /** Two swatch colors used in the picker preview (background, accent). */
  swatches: [string, string];
}

/**
 * Theme catalog. The actual CSS lives in src/styles/global.css and is keyed
 * by [data-theme="..."] selectors. 'auto' resolves to receipt-light /
 * receipt-dark at runtime depending on the OS preference. Receipt is the
 * default brutalist pair; the 10 legacy palettes follow.
 */
export const THEMES: ThemeMeta[] = [
  { id: 'receipt-light', label: 'Receipt — светлая',         variant: 'light', swatches: ['#f5f5f0', '#121212'] },
  { id: 'receipt-dark',  label: 'Receipt — тёмная',          variant: 'dark',  swatches: ['#121212', '#f5f5f0'] },
  { id: 'light-default', label: 'Светлая (классика)',        variant: 'light', swatches: ['#f8fafc', '#2563eb'] },
  { id: 'light-cream',   label: 'Кремовая',                   variant: 'light', swatches: ['#fdf8ee', '#b25c00'] },
  { id: 'light-mint',    label: 'Мятная',                     variant: 'light', swatches: ['#ecfdf5', '#0d9488'] },
  { id: 'light-sky',     label: 'Небесная',                   variant: 'light', swatches: ['#f0f9ff', '#0284c7'] },
  { id: 'light-rose',    label: 'Розовая заря',               variant: 'light', swatches: ['#fff1f2', '#e11d48'] },
  { id: 'dark-slate',    label: 'Тёмный графит',              variant: 'dark',  swatches: ['#0f172a', '#60a5fa'] },
  { id: 'dark-midnight', label: 'Полночь',                    variant: 'dark',  swatches: ['#0b1220', '#7aa2ff'] },
  { id: 'dark-forest',   label: 'Лесной',                     variant: 'dark',  swatches: ['#0f1f17', '#34d399'] },
  { id: 'dark-violet',   label: 'Фиалка',                     variant: 'dark',  swatches: ['#1a132d', '#a78bfa'] },
  { id: 'dark-amber',    label: 'Янтарь',                     variant: 'dark',  swatches: ['#1f1810', '#f59e0b'] },
];

export function isDarkTheme(id: ThemeId): boolean {
  if (id === 'auto') {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }
  return id.startsWith('dark-') || id === 'receipt-dark';
}

/** Resolve 'auto' to a concrete theme id usable as data-theme attribute. */
export function resolveThemeId(id: ThemeId): Exclude<ThemeId, 'auto'> {
  if (id !== 'auto') return id;
  return isDarkTheme(id) ? 'receipt-dark' : 'receipt-light';
}
