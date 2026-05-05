import { wildberriesParser } from '@/parsers/wildberries';
import { extractNmFromUrl, fetchWbProductFromApi } from '@/parsers/wildberries/api';
import { runContentScript } from './run';

runContentScript(wildberriesParser, 'wildberries', {
  enrich: async (url) => {
    const nm = extractNmFromUrl(url);
    if (nm == null) return null;
    return fetchWbProductFromApi(nm, url);
  },
});
