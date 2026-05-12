// One-off rasteriser: reads public/icons/icon.svg and emits PNGs at the
// four sizes Chrome's MV3 extension manifest expects. Uses Playwright's
// bundled Chromium (already a dev dependency) so no extra tooling required.
// Run with: pnpm tsx scripts/build-icons.mjs  (or node — it's plain ESM).
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const SVG = await readFile(resolve(repo, 'public/icons/icon.svg'), 'utf8');
const SIZES = [16, 32, 48, 128];

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;padding:0;background:transparent;">
        <div style="width:${size}px;height:${size}px;display:flex;align-items:stretch;justify-content:stretch;">
          ${SVG.replace(
            /<svg([^>]*)>/,
            `<svg$1 width="${size}" height="${size}" style="display:block;">`,
          )}
        </div>
      </body></html>`,
      { waitUntil: 'load' },
    );
    const buf = await page.screenshot({
      omitBackground: true,
      type: 'png',
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await writeFile(resolve(repo, `public/icons/icon-${size}.png`), buf);
    console.log(`✓ icon-${size}.png (${buf.length} bytes)`);
    await page.close();
  }
} finally {
  await browser.close();
}
