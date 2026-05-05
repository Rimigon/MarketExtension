import { createRoot, type Root } from 'react-dom/client';
import { TrackButton } from './components/TrackButton';
import type { ParsedProduct, Product } from '@/shared/types';

const HOST_ID = 'pricewatch-track-host';
const SHADOW_MOUNT_ID = 'pricewatch-shadow-mount';

interface InjectArgs {
  anchor: HTMLElement;
  parsed: ParsedProduct;
  initialProduct: Product | null;
}

let currentRoot: Root | null = null;
let currentHost: HTMLElement | null = null;

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

export function injectTrackButton({ anchor, parsed, initialProduct }: InjectArgs): void {
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
  currentRoot.render(<TrackButton parsed={parsed} initialProduct={initialProduct} />);
}
