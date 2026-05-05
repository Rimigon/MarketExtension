import { yandexMarketParser } from '@/parsers/yandex-market';
import { runContentScript } from './run';

runContentScript(yandexMarketParser, 'yandex-market');
