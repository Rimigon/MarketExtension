// Stage 2: Wildberries content script.
// For now this script is a no-op so the manifest matcher doesn't fail to load.
// Real implementation: detect /catalog/<id>/detail.aspx, fetch card.wb.ru/cards/v2/detail?nm=<id>,
// inject TrackButton near .product-page__price-block.
export {};
