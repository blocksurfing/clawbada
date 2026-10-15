import { pixelAssets } from '../pixel-assets.js';

const classOrder = ['Bulwark','Mantis','Leviathan','Tempest','Specter','Sentinel','Reaver','Abyss','Kraken','Ember'];

// Dark swatches sampled from Avatar/Avatar_BG.png; class mapping verified against its Unity .meta.
const classBackgrounds = { Bulwark:'#202644', Mantis:'#00283a', Leviathan:'#000065', Tempest:'#302922', Specter:'#200b64', Sentinel:'#416e82', Reaver:'#5f020f', Abyss:'#0e1b2c', Kraken:'#002e32', Ember:'#1d1922' };

// Local design fixtures only. Values and rarity labels do not define game mechanics.
export const demoListings = [
  ['D001','Lobsters','Bulwark','Base','Harbor',0,5,1200,'Common'],
  ['D002','Lobsters','Mantis','Evolved','Reef',1,5,3200,'Rare'],
  ['D003','Eggs',null,null,'Egg Gen 1',null,null,650,'Common'],
  ['D004','Lobsters','Leviathan','Elite','Tide',2,4,6400,'Rare'],
  ['D005','Lobsters','Specter','Apex','Dusk',0,6,12000,'Epic'],
  ['D006','Eggs',null,null,'Egg Gen 2',null,null,850,'Common'],
  ['D007','Lobsters','Reaver','Evolved','Coral',3,3,2600,'Common'],
  ['D008','Lobsters','Abyss','Elite','Trench',1,5,7200,'Epic'],
  ['D009','Eggs',null,null,'Egg Gen 2',null,null,1100,'Rare'],
  ['D010','Lobsters','Ember','Apex','Cinder',2,4,9800,'Epic'],
  ['D011','Lobsters','Bulwark','Evolved','Anchor',1,5,2800,'Rare'],
  ['D012','Eggs',null,null,'Egg Gen 1',null,null,500,'Common'],
].map(([id,type,klass,tier,name,breed,purity,price,rarity]) => ({id,type,klass,tier,name,breed,purity,price,rarity}));

// Create cards once BEFORE the shared pixel mount. Filtering only hides/reorders nodes;
// its ResizeObserver repaints panels as they become visible. No nested/double mounts.
export function mountMarket(root) {
  const market = root.querySelector('[data-market]');
  if (!market) return () => {};
  const form = market.querySelector('form');
  const grid = market.querySelector('.market-grid');

  grid.innerHTML = demoListings.map(item => `<article class="market-card pixel-panel" data-pixel-panel="marketCard" data-listing-id="${item.id}" style="--market-card-bg:${item.type !== 'Eggs' && classBackgrounds[item.klass] ? classBackgrounds[item.klass] : '#2e222f'}" aria-labelledby="market-${item.id}">
    <span class="market-id">#${item.id}</span>
    <header class="market-card-header">
    <div class="market-card-identity"><h3 id="market-${item.id}"><span class="market-tier-symbol" tabindex="0" role="img" aria-label="${item.type === 'Eggs' ? 'Egg' : item.tier}"><span data-pixel-sprite="marketPurity" data-frame="${item.type === 'Eggs' ? 34 : 35 + ['Base','Evolved','Elite','Apex'].indexOf(item.tier)}" aria-hidden="true"></span><span class="market-symbol-label" aria-hidden="true">${item.type === 'Eggs' ? 'Egg' : item.tier}</span><span class="market-class-tooltip" aria-hidden="true">${item.type === 'Eggs' ? 'Egg' : item.tier}</span></span></h3>
    ${item.type === 'Eggs' ? '' : `<span class="market-class-badge" tabindex="0" role="img" aria-label="${item.klass}"><span data-pixel-sprite="classBadges" data-frame="${classOrder.indexOf(item.klass)}" aria-hidden="true"></span><span class="market-symbol-label" aria-hidden="true">${item.klass}</span><span class="market-class-tooltip" aria-hidden="true">${item.klass}</span></span>`}</div>
    ${item.type === 'Eggs' ? '' : `<div class="market-card-right"><dl class="market-details"><div class="market-purity"><dt class="market-purity-label">Purity</dt><dd><span class="market-purity-stars" role="img" aria-label="${item.purity} of 6 purity" tabindex="0" data-header-tooltip="Purity: ${item.purity}/6"><span data-pixel-sprite="marketPurity" data-frame="32" aria-hidden="true"></span> <span>${item.purity}</span></span></dd></div><div class="market-breed" tabindex="0" aria-label="Breed count: ${item.breed}" data-header-tooltip="Breed count: ${item.breed}"><dt><span class="market-purity-label">Breed</span><span data-pixel-sprite="marketBreed" data-frame="33" aria-hidden="true"></span></dt><dd>${item.breed}</dd></div></dl></div>`}
    </header>
    ${item.type === 'Eggs' ? '<div class="market-egg-art"><span class="market-egg-sprite" role="img" tabindex="0" title="Class unknown until hatched" aria-label="Egg — class unknown until hatched"></span></div>' : `<div class="market-lobster-art"><span data-pixel-sprite="market${item.tier}" data-frame="${classOrder.indexOf(item.klass)}" role="img" aria-label="${item.klass} ${item.tier}"></span></div>`}
    <div class="market-card-divider" data-pixel-panel="marketDivider" aria-hidden="true"></div>
    <footer class="market-card-footer"><div class="market-card-actions"><button type="button" class="pixel-button market-buy" data-pixel-panel="marketPriceLabel" aria-label="Buy ${item.id} for ${item.price.toLocaleString('en-US')} GOLD"><span data-pixel-sprite="menuIcons" data-frame="8" aria-hidden="true"></span><span class="market-buy-price">${item.price.toLocaleString('en-US')}</span></button><button type="button" class="pixel-button" data-pixel-panel="marketBidButton" aria-label="Bid on ${item.id}">Bid</button></div></footer>
  </article>`).join('');
  for (const sprite of grid.querySelectorAll('.market-egg-sprite')) sprite.style.backgroundImage = `url("${pixelAssets.marketEgg.src}")`;
  const cards = new Map([...grid.children].map(card => [card.dataset.listingId, card]));
  const previous = market.querySelector('[data-market-prev]');
  const next = market.querySelector('[data-market-next]');
  let page = 1;
  function render() {
    const result = selectListings(demoListings, Object.fromEntries(new FormData(form)), page);
    page = result.page;
    for (const card of cards.values()) card.hidden = true;
    for (const item of result.items) { const card = cards.get(item.id); card.hidden = false; grid.append(card); }
    market.querySelector('[data-market-page]').textContent = `Page ${page} of ${result.pages}`;
    market.querySelector('[data-market-empty]').hidden = result.total !== 0;
    previous.disabled = page === 1;
    next.disabled = page === result.pages;
  }
  function filter() { page = 1; render(); }
  function reset(event) {
    event.preventDefault();
    for (const control of form.elements) {
      if (!control.name) continue;
      if (control.type === 'radio') control.checked = control.defaultChecked;
      else control.value = '';
    }
    filter();
  }
  function paginate(event) { page += event.currentTarget === next ? 1 : -1; render(); }
  function submit(event) { event.preventDefault(); }
  form.addEventListener('input', filter);
  form.addEventListener('change', filter);
  form.addEventListener('reset', reset);
  form.addEventListener('submit', submit);
  previous.addEventListener('click', paginate);
  next.addEventListener('click', paginate);
  render();
  return () => {
    form.removeEventListener('input', filter);
    form.removeEventListener('change', filter);
    form.removeEventListener('reset', reset);
    form.removeEventListener('submit', submit);
    previous.removeEventListener('click', paginate);
    next.removeEventListener('click', paginate);
  };
}

export function selectListings(listings, filters = {}, requestedPage = 1) {
  const matches = listings.filter(item =>
    ['type','klass','tier','rarity'].every(key => !filters[key] || item[key] === filters[key]) &&
    (filters.purity === '' || filters.purity == null || (item.purity !== null && item.purity >= Number(filters.purity))) &&
    item.price >= Number(filters.minPrice || 0) &&
    item.price <= (filters.maxPrice === '' || filters.maxPrice == null ? Infinity : Number(filters.maxPrice)));
  const comparators = {
    'price-asc':(a,b) => a.price-b.price,
    'price-desc':(a,b) => b.price-a.price,
    'purity-desc':(a,b) => b.purity-a.purity,
  };
  if (comparators[filters.sort]) matches.sort(comparators[filters.sort]);
  const pageSize = 8; // Two full rows at the four-column desktop maximum.
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.max(1, Math.min(pages, requestedPage));
  return {items:matches.slice((page-1)*pageSize,page*pageSize),total:matches.length,pages,page};
}
