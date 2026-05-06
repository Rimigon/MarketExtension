import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'PriceWatch — отслеживание цен',
  short_name: 'PriceWatch',
  description: 'Следите за ценами на Ozon, Wildberries и Яндекс Маркете прямо со страницы товара.',
  version: pkg.version,
  icons: {
    16: 'public/icons/icon-16.png',
    32: 'public/icons/icon-32.png',
    48: 'public/icons/icon-48.png',
    128: 'public/icons/icon-128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'PriceWatch',
    default_icon: {
      16: 'public/icons/icon-16.png',
      32: 'public/icons/icon-32.png',
    },
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://www.ozon.ru/*', 'https://ozon.ru/*'],
      js: ['src/content/ozon.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
    {
      matches: ['https://www.wildberries.ru/*', 'https://wildberries.ru/*'],
      js: ['src/content/wildberries.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
    {
      matches: ['https://market.yandex.ru/*'],
      js: ['src/content/yandex-market.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: ['storage', 'alarms', 'notifications', 'tabs'],
  host_permissions: [
    'https://*.ozon.ru/*',
    'https://*.wildberries.ru/*',
    // WB exposes its catalog data via u-card.wb.ru / card.wb.ru — needed for the JSON API path.
    'https://*.wb.ru/*',
    // basket-XX.wbbasket.ru hosts the rich card.json (description + specs) and product images.
    'https://*.wbbasket.ru/*',
    'https://market.yandex.ru/*',
  ],
  web_accessible_resources: [
    {
      resources: ['src/dashboard/index.html', 'public/icons/*'],
      matches: [
        'https://*.ozon.ru/*',
        'https://*.wildberries.ru/*',
        'https://market.yandex.ru/*',
      ],
    },
  ],
});
