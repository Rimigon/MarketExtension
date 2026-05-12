import { useState } from 'react';
import type { Marketplace } from '@/shared/types';
import { MARKETPLACE_ACCENT, MARKETPLACE_LABELS } from '@/shared/constants';
import { otherMarketplaces, searchOnMarketplace } from '@/shared/url';

interface Props {
  marketplace: Marketplace;
  title: string;
  /** Optional layout hint. 'inline' = compact row of badges; 'block' = same but
   *  with a label prefix. Defaults to 'inline'. */
  variant?: 'inline' | 'block';
}

/**
 * "Look up this product on the other marketplaces" — renders one button per
 * marketplace other than `marketplace`. Click copies `title` to the clipboard
 * and opens the target marketplace's search page in a new tab.
 *
 * Used in the dashboard `ProductDetail` header. The on-page floating-button
 * (`src/content/components/TrackButton.tsx`) renders an inline-styled
 * equivalent so the same affordance shows up directly on marketplace pages.
 */
export function CrossMarketplaceLinks({ marketplace, title, variant = 'inline' }: Props) {
  const others = otherMarketplaces(marketplace);
  const [copied, setCopied] = useState<Marketplace | null>(null);

  async function handleClick(target: Marketplace) {
    await searchOnMarketplace(target, title);
    setCopied(target);
    // Short-lived "✓ скопировано" hint — long enough for the user to notice but
    // short enough that focus returns to the row's normal labels promptly.
    setTimeout(() => setCopied((c) => (c === target ? null : c)), 1800);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {variant === 'block' && (
        <span className="uppercase tracking-receipt text-slate-500">
          Найти на:
        </span>
      )}
      {others.map((m) => {
        const accent = MARKETPLACE_ACCENT[m];
        return (
          <button
            key={m}
            type="button"
            onClick={() => void handleClick(m)}
            title={`Скопировать название и открыть поиск на ${MARKETPLACE_LABELS[m]}`}
            className="inline-flex items-center gap-1 border px-2 py-0.5 font-semibold uppercase tracking-receipt transition hover:brightness-95"
            style={{
              borderColor: accent.stripe,
              color: accent.stripe,
              background: accent.bg,
            }}
          >
            <span aria-hidden>↗</span>
            <span>{MARKETPLACE_LABELS[m]}</span>
            {copied === m && (
              <span className="ml-1 font-normal normal-case tracking-normal opacity-70">
                · скопировано
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
