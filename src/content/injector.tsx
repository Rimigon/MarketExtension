import { createRoot, type Root } from 'react-dom/client';
import { TrackButton } from './components/TrackButton';
import { StatsFloater } from './components/StatsFloater';
import type { ParsedProduct, Product } from '@/shared/types';

const HOST_ID = 'pricewatch-track-host';
const SHADOW_MOUNT_ID = 'pricewatch-shadow-mount';
const FLOATER_HOST_ID = 'pricewatch-floater-host';

interface InjectArgs {
  anchor: HTMLElement;
  parsed: ParsedProduct;
  initialProduct: Product | null;
  /** Notified when the user toggles tracking on/off via the in-page button.
   *  null = product was just removed, Product = was just added/refreshed. */
  onTrackingChange?: (product: Product | null) => void;
}

let currentRoot: Root | null = null;
let currentHost: HTMLElement | null = null;

let floaterRoot: Root | null = null;
let floaterHost: HTMLElement | null = null;
let floaterProductId: string | null = null;

export function teardownInjection(): void {
  if (currentRoot) {
    try { currentRoot.unmount(); } catch { /* noop */ }
    currentRoot = null;
  }
  if (currentHost) {
    currentHost.remove();
    currentHost = null;
  }
}

export function injectTrackButton({ anchor, parsed, initialProduct, onTrackingChange }: InjectArgs): void {
  teardownInjection();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.all = 'initial';
  host.style.display = 'block';

  const shadow = host.attachShadow({ mode: 'open' });
  const mount = document.createElement('div');
  mount.id = SHADOW_MOUNT_ID;
  shadow.appendChild(mount);

  // Inserted after the anchor so we don't break flex/grid layouts of the price block.
  anchor.insertAdjacentElement('afterend', host);
  currentHost = host;

  currentRoot = createRoot(mount);
  currentRoot.render(
    <TrackButton
      parsed={parsed}
      initialProduct={initialProduct}
      onChange={onTrackingChange}
    />,
  );
}

/**
 * Mount the bottom-right stats floater for a tracked product. Lives at body
 * level (separate Shadow host) so it survives MutationObserver-driven
 * re-injects of the inline TrackButton. Idempotent: re-mounting with the same
 * productId rerenders props; with a different id, tears down and recreates.
 */
export function injectStatsFloater(product: Product): void {
  if (floaterHost && floaterRoot && floaterProductId === product.id) {
    floaterRoot.render(<StatsFloater product={product} onUntrack={teardownStatsFloater} />);
    return;
  }
  teardownStatsFloater();

  const host = document.createElement('div');
  host.id = FLOATER_HOST_ID;
  host.style.all = 'initial';
  // Host pins to the viewport corner; the floater inside is normal-flow so it
  // can freely lay out the pill + expanded panel.
  host.style.position = 'fixed';
  host.style.right = '16px';
  host.style.bottom = '16px';
  host.style.zIndex = '2147483000';
  host.style.pointerEvents = 'none';
  host.style.display = 'block';

  const shadow = host.attachShadow({ mode: 'open' });
  const mount = document.createElement('div');
  shadow.appendChild(mount);

  document.body.appendChild(host);
  floaterHost = host;
  floaterProductId = product.id;
  floaterRoot = createRoot(mount);
  floaterRoot.render(<StatsFloater product={product} onUntrack={teardownStatsFloater} />);
}

export function teardownStatsFloater(): void {
  if (floaterRoot) {
    try { floaterRoot.unmount(); } catch { /* noop */ }
    floaterRoot = null;
  }
  if (floaterHost) {
    floaterHost.remove();
    floaterHost = null;
  }
  floaterProductId = null;
}
