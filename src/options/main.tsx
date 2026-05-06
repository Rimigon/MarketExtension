// Options page is now part of the dashboard. Redirect immediately so callers
// (chrome.runtime.openOptionsPage, popup «Настройки» link, chrome://extensions)
// land on the unified UI at dashboard #settings.
const target = chrome.runtime.getURL('src/dashboard/index.html') + '#settings';
window.location.replace(target);
