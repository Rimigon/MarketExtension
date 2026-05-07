import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { ThemeId } from '@/shared/types';
import { resolveThemeId } from '@/shared/themes';

/**
 * Loads the persisted theme, applies it to <html data-theme="...">, and
 * re-applies on prefers-color-scheme changes when theme === 'auto'.
 * Also listens for live settings updates broadcast by other dashboard tabs.
 */
export function useThemeApplier() {
  const [theme, setTheme] = useState<ThemeId>('auto');

  useEffect(() => {
    let cancelled = false;
    void sendRpc('settings/get', {}).then((resp) => {
      if (!cancelled) setTheme(resp.settings.theme);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.setAttribute('data-theme', resolveThemeId(theme));
    };
    apply();

    if (theme === 'auto' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => apply();
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [theme]);

  return { theme, setTheme };
}
