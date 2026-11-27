import { emptyState, normalizeState, addCard, updateEntry, removeEntry, totals, recordSnapshot, exportCSV, CONDITIONS, SEALED_TYPES, effectivePrice, applyMarketUpdate, applySealedMarketUpdate } from './model.js';
import { CATALOGUE_PAGE_SIZE, searchCards, searchCardPrintings, getCard, getSet, getSets, cardImage } from './catalog.js';
import { CATALOGUE_LANGUAGES, catalogueLanguage, languageLabel, marketCardKey, marketLanguage } from './languages.js';
import { catalogueAlias, catalogueCardTitle, catalogueQuery, catalogueSetName, printedSearchName } from './pokemon-search.js';
import { getPrices, getPriceHistory, priceServiceHealth } from './price-client.js';
import { normalizeQuote, quoteStatus } from './pricing.js';
import { priceBadge, identityLabel, coveragePanel, marketPanel, variantFields, personalFields, historyPanel } from './price-view.js';
import { searchSealed, getSealedProduct, getSealedHistory } from './sealed-client.js';
import { sealedFields, sealedPricePanel, sealedValuationHistory, sealedPublicHistory, sealedIdentity, sealedAttribution } from './sealed-view.js';
import { productImage, productPhotoSource, safePhotoURL } from './photos.js';
import { isInstalled, promptInstallation, setupInstallation } from './install.js';
import { cardOfferKey, cardOfferReference } from './card-offers.js';
import { isRegionalIdentity } from './regional-catalogue.js';
import { EDITION_LABELS, findEditionPrintings, groupCardEditions } from './catalogue-editions.js';

const icons = {
  home:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  cards:'<rect x="7" y="5" width="13" height="16" rx="2"/><path d="M4 17 2 5a2 2 0 0 1 1.6-2.3l9-1.5"/><path d="M11 10h5m-5 4h5"/>',
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  sets:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="m15 18 2 2 4-5"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  down:'<path d="m8 10 4 4 4-4"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  shield:'<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  wallet:'<path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h15v11H6a3 3 0 0 1-3-3V6"/><path d="M21 12h-5v5h5"/>',
  trend:'<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>',
  chart:'<path d="M4 4v16h17M7 15l4-6 4 3 6-7"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  refresh:'<path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
  box:'<path d="m12 3 9 5v9l-9 5-9-5V8Zm0 9 9-4m-9 4L3 8m9 4v10m-4-16 9 5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.cards}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const euro = value => value === null || value === undefined ? 'Unavailable' : new Intl.NumberFormat('en-IE', {style:'currency',currency:'EUR',maximumFractionDigits:2}).format(value);
const num = value => new Intl.NumberFormat('en-GB').format(value);
const dateLabel = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value)) : 'Date unavailable';
const cardSetTitle = card => card.kind === 'sealed' ? card.setName : catalogueSetName(card.setName, card.setId, card.lang);
// Imported sets may have catalogue languages that are absent from the selector.
const catalogueSetLanguage = value => {
  const market = marketLanguage(value);
  return market !== 'en' ? market : typeof value === 'string' && /^[a-z]{2}(?:-[a-z]{2})?$/.test(value) ? value : 'en';
};
// Keep existing storage keys so the new brand retains every saved collection.
const STORAGE_KEY = 'pocketvault.collection.v1';
const MIGRATION_BACKUP_KEY = 'pocketvault.before-v2';
const pages = {dashboard:'Overview',collection:'My collection',wishlist:'Wishlist',binders:'Binders',sets:'Set progress',catalog:'Discover cards',sealed:'Sealed products',settings:'Data & backups'};
const ALL_PRINTINGS = 'all';
let state = emptyState(), storageWarning = '', recoveredRaw = '', migrationBackup = '', migrationPending = false;
let searchLanguage = ALL_PRINTINGS, catalogueSetsLanguage = 'en';
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  migrationBackup=localStorage.getItem(MIGRATION_BACKUP_KEY)||'';
  if (raw) {
    try {
      const parsed=JSON.parse(raw);
      state=normalizeState(parsed);
      if(parsed.version===1){
        migrationPending=true; migrationBackup=raw;
        try {localStorage.setItem(MIGRATION_BACKUP_KEY,raw);localStorage.setItem(STORAGE_KEY,JSON.stringify(state));migrationPending=false;}
        catch {storageWarning='Your upgraded vault is open, but its recovery copy could not be saved. Download a JSON backup before making changes.';}
      }
    } catch { recoveredRaw = raw; storageWarning = 'Your saved data could not be read. Download a recovery copy in Data & backups before making changes.'; }
  }
  catalogueSetsLanguage = catalogueLanguage(localStorage.getItem('pocketvault.lang'));
} catch { storageWarning = 'Browser storage is unavailable. Changes will last for this visit only; export a backup before closing.'; }
let page = pages[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
let featured = [], query = '', searchPage = 1, searchResults = [], searchError = '', searching = false, searchTicket = 0, setView = null;
const CATALOGUE_SEARCH_DELAY = 300;
let catalogueInput = '', catalogueSearchTimer, searchHasMore = false, searchUnavailable = [], loadingMoreEditions = false;
let searchMoreError = '', englishSetNames = new Map();
let lastSetRequest = null, listingSets = false, catalogueSets = [];
let collectionQuery = '', binderFilter = 'all', kindFilter = 'all', languageFilter = '', setFilter = '', valuationFilter = '';
let sort = 'recent', view = 'grid', range = '30', collectionPage = 1;
const selectedEntries = new Set();
const COLLECTION_PAGE_SIZE = 48;
let sealedQuery = '', sealedType = '', sealedPage = 1, sealedResult = null, sealedError = '', sealedLoading = false, sealedTicket = 0;
let modalCard = null, modalEntry = null, modalWish = null, modalMode = 'collect', modalTicket = 0;
let modalBundle = null, modalWarning = '', modalDraft = null, modalHistoryTicket = 0;
let modalEdition = null;
let refreshing = false, toastTimer, undoAction = null, pendingImport = null, lastAutoRefresh = 0, priceService = null;
let activeImport = null;
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const toastEl = document.querySelector('#toast');

function imageURL(card, high = false) {
  if(card.kind==='sealed')return productImage(card,high?'high':'low');
  if(high){const original=cardImage(card,'high');if(original)return original;}
  const local = featured.find(item => item.id === card.id && item.lang === card.lang);
  return cardImage(local || card, high ? 'high' : 'low');
}
function art(card, classes = '', high = false) {
  if(card.kind==='sealed'){
    const src=imageURL(card,high);
    return src?`<span class="sealed-art product-photo"><img src="${esc(src)}" alt="${esc(card.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="photo-fallback" aria-label="Product image unavailable">${icon('box')}</span></span>`:`<span class="sealed-art" aria-label="Sealed product">${icon('box')}</span>`;
  }
  const src = imageURL(card, high);
  return src ? `<img class="${classes}" src="${esc(src)}" alt="${esc(catalogueCardTitle(card))}" loading="lazy" decoding="async"><span class="card-art-fallback" aria-label="Card image unavailable">${icon('cards')}</span>` : icon('cards');
}
function button(label, action, symbol, cls = '') {
  return `<button class="button ${cls}" data-action="${action}">${symbol ? icon(symbol) : ''}${label}</button>`;
}
function toast(message, undo = null) {
  clearTimeout(toastTimer); undoAction = undo;
  toastEl.innerHTML = `${esc(message)}${undo ? ' <button class="text-button" data-action="undo">Undo</button>' : ''}`;
  toastEl.classList.add('show'); toastEl.style.pointerEvents = undo ? 'auto' : 'none';
  toastTimer = setTimeout(() => {toastEl.classList.remove('show');undoAction = null;}, undo ? 15000 : 5500);
}
function commit(next, snapshot = false, reason = 'collection') {
  const clean = normalizeState(snapshot ? recordSnapshot(next,reason) : next);
  undoAction = null;
  if (recoveredRaw) throw new Error('Download the recovery copy and resolve the unreadable backup in Data & backups first.');
  try {
    if(migrationPending){localStorage.setItem(MIGRATION_BACKUP_KEY,migrationBackup);migrationPending=false;}
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); storageWarning = '';
  }
  catch { storageWarning = 'Your browser could not save these changes. Export a JSON backup before closing this page.'; }
  state = clean;
  if(selectedEntries.size){
    const remaining=new Set(state.collection.map(entry=>entry.uid));
    for(const uid of selectedEntries)if(!remaining.has(uid))selectedEntries.delete(uid);
  }
  render();
}
function navigate(next) {
  if (!pages[next]) return;
  page = next;
  if (location.hash !== `#${next}`) history.replaceState(null,'',`#${next}`);
  render(); window.scrollTo({top:0,behavior:'instant'});
  if(next==='sealed'&&!sealedResult&&!sealedLoading)void runSealedSearch();
}
function heading(title, subtitle, actions = '') {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function empty(symbol,title,description,cta = 'Discover cards',action = 'discover') {
  return `<div class="empty-state">${icon(symbol)}<h2>${title}</h2><p>${description}</p>${cta ? button(cta,action,'plus','primary') : ''}</div>`;
}
function skeletons() { return `<div class="card-grid collection-grid">${Array.from({length:8},()=>'<div class="skeleton"></div>').join('')}</div>`; }

const pageIcons = {dashboard:'home',collection:'cards',wishlist:'heart',binders:'folder',sets:'sets',catalog:'search',sealed:'box',settings:'download'};
const morePages = ['binders','sets','sealed','settings'];

function pageButton(id, label=pages[id], count) {
  const active=page===id;
  return `<button type="button" data-page="${id}"${active?' class="active" aria-current="page"':''}>${icon(pageIcons[id])}<span>${label}</span>${count===undefined?'':`<span class="count">${num(count)}</span>`}</button>`;
}

function render() {
  const focusedInput = page==='catalog' && document.activeElement?.id==='catalog-query' ? document.activeElement : null;
  const counts = {collection:totals(state).quantity,wishlist:state.wishlist.length};
  app.innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="#dashboard" data-page="dashboard" aria-label="Monstertrade overview"><img src="./assets/monstertrade-logo.jpg" width="1280" height="853" alt="Monstertrade"></a>
      <nav class="nav" aria-label="Main navigation">${Object.keys(pages).map(id=>pageButton(id,pages[id],counts[id])).join('')}</nav>
    </aside>
    <div class="app-shell">
      <header class="topbar">
        <div class="breadcrumb">
          <a class="brand-wordmark" href="#dashboard" data-page="dashboard" aria-label="Monstertrade overview">Monster<span>trade</span></a>
          ${icon('chevron')}<strong>${pages[page]}</strong>
        </div>
        <div class="top-actions">
          <button class="global-search" data-action="focus-search" aria-label="Search the card catalogue">${icon('search')}<span>Search any card…</span><kbd>/</kbd></button>
          <span class="local-status">${icon(storageWarning?'info':'shield')}${storageWarning?'Backup recommended':'Saved on this device'}</span>
          <button type="button" class="button subtle small-button install-app" data-action="install-app" aria-label="Install Monstertrade" ${isInstalled()?'hidden':''}>${icon('download')}<span>Install</span></button>
        </div>
      </header>
      <main id="main" class="main" tabindex="-1">
        ${storageWarning?`<div class="notice warning">${esc(storageWarning)} <button class="text-button" data-page="settings">Manage backups</button></div>`:''}
        ${renderPage()}
        <footer class="footer"><span>Monstertrade</span><span>Card data &amp; market references by <a href="https://tcgdex.dev" target="_blank" rel="noopener noreferrer">TCGdex</a> · Independent fan project</span><div>${sealedAttribution()}<p class="photo-source">Pokémon species names: <a href="./POKEAPI-LICENSE.txt">PokéAPI</a>. Regional catalogue data: <a href="https://github.com/cardcorpus/pokemon-card-dataset" target="_blank" rel="noopener noreferrer">CardCorpus</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>. Card images: TCGdex and CardCorpus. Sealed catalogue images: TCGplayer. Images are reference illustrations; check language and edition.</p></div></footer>
      </main>
    </div>
    <nav class="mobile-nav" aria-label="Mobile navigation">
      ${pageButton('dashboard','Home')}${pageButton('collection','Collection')}${pageButton('catalog','Search')}${pageButton('wishlist','Wishlist')}
      <button type="button" data-action="more-navigation" aria-haspopup="dialog" aria-controls="modal"${morePages.includes(page)?' class="active"':''}>${icon('menu')}<span>More</span></button>
    </nav>`;
  if(focusedInput){
    const input=document.querySelector('#catalog-query');
    input.focus({preventScroll:true});
    input.setSelectionRange(focusedInput.selectionStart,focusedInput.selectionEnd,focusedInput.selectionDirection);
  }
}
function renderPage() {
  if(page==='dashboard') return dashboard();
  if(page==='collection') return collection();
  if(page==='catalog') return catalog();
  if(page==='sealed') return sealedCatalog();
  if(page==='wishlist') return wishlist();
  if(page==='binders') return binders();
  if(page==='sets') return sets();
  return settings();
}
function dashboard() {
  const t=totals(state);
  const stats = [
    ['Estimated value',t.pricedQuantity?euro(t.value):'—','wallet',t.unpricedQuantity?`${num(t.unpricedQuantity)} items without a valuation`:'References + personal valuations'],
    ['Purchase cost',euro(t.cost),'box','Your recorded purchase costs'],
    ['Items collected',num(t.quantity),'cards',`${num(state.collection.filter(c=>c.kind!=='sealed').reduce((n,c)=>n+c.quantity,0))} cards · ${num(state.collection.filter(c=>c.kind==='sealed').reduce((n,c)=>n+c.quantity,0))} sealed`],
    ['Estimated difference',signedEuro(t.pricedQuantity?t.profit:null),'trend',t.quantity?'Value minus cost · valued items only':'Your collection starts here'],
  ];
  const valuable=[...state.collection].filter(c=>effectivePrice(c)!==null).sort((a,b)=>effectivePrice(b)*b.quantity-effectivePrice(a)*a.quantity).slice(0,3);
  return `${heading('Overview', 'Cards, sealed products, and collection value.',button('Import','import','upload','subtle')+button('Add sealed','discover-sealed','box','subtle')+(t.quantity?button('Add cards','discover','plus','primary'):''))}
  ${!state.collection.length?`<section class="hero"><div class="hero-content"><h2>Start your collection</h2><p>Find a card and add it to your vault.</p><div class="hero-actions">${button('Find cards','discover','search','primary')}</div></div><div class="hero-art" aria-hidden="true">${[featured[2],featured[0],featured[1]].filter(Boolean).map(c=>`<img src="${esc(imageURL(c))}" alt="">`).join('')}<span class="hero-spark">✧</span></div></section>`:''}
  <section class="stats" aria-label="Collection summary">${stats.map(([label,value,symbol,note],i)=>`<div class="stat"><div class="stat-top"><span>${label}</span>${icon(symbol)}</div><div class="stat-value ${i===3&&t.profit!==0?(t.profit>0?'positive':'negative'):''}">${value}</div><div class="stat-foot">${i===3&&t.profit>0?icon('trend'):''}${note}</div></div>`).join('')}</section>
  ${coveragePanel(state)}<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>Collection value</h2><p>Recorded collection totals</p></div><div class="range-picker" aria-label="History period">${['7','30','all'].map(r=>`<button data-range="${r}" class="${range===r?'active':''}" aria-pressed="${range===r}">${r==='all'?'All':`${r}D`}</button>`).join('')}</div></div>${chart()}<p class="day-note">These totals include additions, removals, and personal valuations. Open an item to see its price observations separately.</p></section><section class="panel"><div class="panel-heading"><h2>Collection highlights</h2><span class="small muted">By total value</span></div>${valuable.length?valuable.map((c,i)=>`<button class="top-card" data-entry="${esc(c.uid)}"><span class="rank">0${i+1}</span>${art(c)}<span class="card-summary"><strong>${esc(catalogueCardTitle(c))}</strong><small>${esc(cardSetTitle(c))} · ${c.quantity}×</small></span><span class="card-value">${euro(effectivePrice(c)*c.quantity)}</span></button>`).join(''):`<div class="small-empty">${icon('spark')}<h3>Make room for your favorites</h3><p>Your most valuable cards will find a home right here.</p><button class="text-button" data-action="discover">Discover your first card</button></div>`}</section></div>
  <section><div class="section-heading"><div><h2>${state.collection.length?'Worth a spot in your binder':'A few collector favorites'}</h2><p>A little inspiration for your next discovery.</p></div>${button('Explore catalogue','discover',null,'subtle small-button')}</div><div class="card-grid">${featured.map(c=>cardTile(c,'catalog')).join('')}</div>${featured.length?'<p class="card-footer-note">Featured prices are saved reference snapshots, dated on each card’s detail view. Open a card to request the latest available price.</p>':'<div class="notice">The featured catalogue is unavailable. You can still search for cards.</div>'}</section>`;
}
function chart() {
  let points=state.history;
  if(range!=='all') {const cutoff=new Date();cutoff.setDate(cutoff.getDate()-Number(range));points=points.filter(p=>new Date(p.date+'T23:59:59')>=cutoff);}
  if(!points.length || !state.collection.length) return `<div class="chart-wrap"><div class="chart-empty">${icon('chart')}<strong>Your collection has a future.</strong><p>Add a card to start your value history. New snapshots are saved as you use your vault.</p></div></div>`;
  const width=560,height=160,pad=40, max=Math.max(...points.map(p=>p.value),1)*1.15;
  const coords=points.map((p,i)=>[pad+(points.length===1?.5:i/(points.length-1))*(width-pad-15),height-22-p.value/max*(height-38)]);
  const line=coords.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area=`${line} L${coords.at(-1)[0]},${height-22} L${coords[0][0]},${height-22}Z`;
  return `<div class="chart-summary">${euro(points.at(-1).value)}</div><div class="chart-wrap"><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${points.length} recorded daily value snapshots"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#6fa5ff" stop-opacity=".23"/><stop offset="1" stop-color="#6fa5ff" stop-opacity="0"/></linearGradient></defs>${[0,.5,1].map(p=>`<line x1="${pad}" y1="${height-22-p*(height-38)}" x2="${width}" y2="${height-22-p*(height-38)}" stroke="#ffffff08"/><text x="0" y="${height-18-p*(height-38)}">€${num(Math.round(max*p))}</text>`).join('')}${points.length>1?`<path d="${area}" fill="url(#chart-fill)"/><path d="${line}" stroke="#6fa5ff" stroke-width="2.5" fill="none"/>`:''}${coords.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="${points.length===1?5:3}" fill="#ffa34d"><title>${points[i].date}: ${euro(points[i].value)} · ${esc((points[i].reasons||[points[i].reason||'legacy']).join(', '))}</title></circle>`).join('')}<text x="${pad}" y="158">${esc(dateLabel(points[0].date))}</text>${points.length>1?`<text x="${width-3}" y="158" text-anchor="end">${esc(dateLabel(points.at(-1).date))}</text>`:''}</svg></div>${points.length===1?'<p class="day-note">First snapshot saved. Come back another day to see the trend.</p>':''}`;
}
function cardTile(card, type = 'catalog') {
  if(card.kind==='sealed')return sealedTile(card,type==='collection');
  const cardLanguage = card.lang || catalogueSetsLanguage;
  const attrs = type==='collection'?`data-entry="${esc(card.uid)}"`:`data-card="${esc(card.id)}" data-lang="${esc(cardLanguage)}"`;
  const isOwned = state.collection.some(c=>c.id===card.id&&c.lang===cardLanguage);
  const knownPrice = Object.hasOwn(card,'price');
  const value=type==='collection'?effectivePrice(card):card.price;
  const select=type==='collection'?entryCheckbox(card):'';
  const title=catalogueCardTitle(card);
  const asian=marketLanguage(card.lang)!=='en';
  const number=card.localId?`#${card.localId}`:'';
  const printing=asian?[isRegionalIdentity(card.id,card.lang)?card.setCode:card.setId,number].filter(Boolean).join(' · '):'';
  const setName=cardSetTitle(card)||(printing?'':card.setId||'Pokémon TCG');
  const printingLabel=[printing,type==='catalog'?languageLabel(cardLanguage):''].filter(Boolean).join(' · ');
  const accessibleTitle=[title,printing||(type==='catalog'?number:''),type==='catalog'?languageLabel(cardLanguage):''].filter(Boolean).join(' · ');
  return `<article class="pokemon-card">${select}<button class="card-open" ${attrs} aria-label="View ${esc(accessibleTitle)}"><div class="card-art">${art(card)}${type==='collection'?`<span class="card-badge">${card.quantity} owned</span>`:isOwned?'<span class="card-badge">In your vault</span>':''}</div><div class="card-name">${esc(title)}</div>${title!==card.name?`<div class="card-native" lang="${esc(card.lang)}">${esc(card.name)}</div>`:''}${setName?`<div class="card-set">${esc(setName)}${!asian&&number?` · ${esc(number)}`:''}</div>`:''}${printingLabel?`<div class="card-print">${esc(printingLabel)}</div>`:''}</button><div class="card-bottom"><span class="card-price">${knownPrice?(value==null?'Not valued':type==='catalog'&&marketLanguage(card.lang)!=='en'?'View prices':euro(value)):'View details'}</span><button class="icon-button" ${attrs} aria-label="${type==='collection'?'Edit':'Add'} ${esc(accessibleTitle)}">${icon(type==='collection'?'chevron':'plus')}</button></div>${type==='collection'?`<div class="card-quantity">${esc(identityLabel(card))}</div>${priceBadge(card)}`:''}</article>`;
}
function sealedTile(product, owned=false) {
  const attrs=owned?`data-entry="${esc(product.uid)}"`:`data-sealed="${esc(product.id)}"`;
  const amount=owned?effectivePrice(product):product.market?.amount;
  return `<article class="pokemon-card sealed-tile">${owned?entryCheckbox(product):''}<button class="card-open" ${attrs} aria-label="View ${esc(product.name)}"><div class="card-art">${art(product)}<span class="card-badge">${owned?`${product.quantity} owned`:esc(SEALED_TYPES.find(t=>t.id===product.productType)?.label||'Sealed')}</span></div><div class="card-name">${esc(product.name)}</div><div class="card-set">${esc(product.setName)}</div></button><div class="card-bottom"><span class="card-price">${amount==null?'Not valued':euro(amount)}</span><button class="icon-button" ${attrs} aria-label="${owned?'Edit':'Add'} ${esc(product.name)}">${icon(owned?'chevron':'plus')}</button></div><div class="card-quantity">${owned?esc(sealedIdentity(product)):'EU retail · language unspecified'}</div>${owned?priceBadge(product):`<span class="price-tag ${quoteStatus(product.market)==='current'?'':'caution'}">${product.market?.lastError?'Update failed':product.market?.amount==null?'No in-stock retail reference':quoteStatus(product.market)==='stale'?'Older retail price':'Lowest in-stock store price'}</span>`}</article>`;
}
function sealedCatalog() {
  return `${heading('Sealed. Collected. Tracked.','Booster packs, boxes, Elite Trainer Boxes, tins and collections.',button('Add custom product','new-sealed','plus','primary'))}<div class="notice">EU retail asking prices from stores with stock. These are shopping references, not completed sales or guaranteed resale values. Product language is not specified by this source.</div><form id="sealed-search-form" class="toolbar"><div class="search-field">${icon('search')}<input id="sealed-query" name="query" aria-label="Search sealed products" placeholder="Search a product or set…" maxlength="100" value="${esc(sealedQuery)}"></div><div class="toolbar-group"><select id="sealed-type" name="type" aria-label="Sealed product type"><option value="">All sealed products</option>${SEALED_TYPES.map(t=>`<option value="${t.id}" ${sealedType===t.id?'selected':''}>${esc(t.label)}</option>`).join('')}</select><button class="button primary" type="submit">${icon('search')}Search</button></div></form><div id="sealed-results">${sealedResults()}</div><div class="card-footer-note">${sealedAttribution()}<p>Missing a product? Add it manually and record dated valuations with source links.</p></div>`;
}
function sealedResults() {
  if(sealedLoading)return skeletons();
  if(sealedError)return empty('box','The sealed catalogue is unavailable.',`${esc(sealedError)} You can still add a custom product and record its value.`,'Try again','retry-sealed');
  const result=sealedResult;
  if(!result)return '';
  if(!result.items.length)return empty('box','No sealed products found.','Try a different name or type, or add the product yourself.','Add custom product','new-sealed');
  return `${result.lastError?`<div class="notice warning">${esc(result.lastError)} Saved observations remain visible with their original dates.</div>`:''}<div class="result-note"><span>${num(result.total)} matching sealed products</span><span>EUR · Source date shown in product details</span></div><div class="card-grid collection-grid">${result.items.map(p=>sealedTile(p)).join('')}</div><div class="pagination"><button class="button subtle small-button" data-action="sealed-previous" ${sealedPage<=1?'disabled':''}>Previous</button><span>Page ${sealedPage}</span><button class="button subtle small-button" data-action="sealed-next" ${sealedPage*result.pageSize>=result.total?'disabled':''}>Next</button></div>`;
}
async function runSealedSearch() {
  const ticket=++sealedTicket;sealedLoading=true;sealedError='';updateSealedResults();
  try{const result=await searchSealed(sealedQuery,{type:sealedType,page:sealedPage});if(ticket===sealedTicket)sealedResult=result;}
  catch(error){if(ticket===sealedTicket)sealedError=error.message;}
  finally{if(ticket===sealedTicket){sealedLoading=false;updateSealedResults();}}
}
function updateSealedResults(){const target=document.querySelector('#sealed-results');if(target)target.innerHTML=sealedResults();}
function entryCheckbox(entry) {
  return `<label class="entry-select"><input type="checkbox" data-select-entry="${esc(entry.uid)}" aria-label="Select ${esc(entry.name)}" ${selectedEntries.has(entry.uid)?'checked':''}></label>`;
}

function filterOptions(entries, selected) {
  return [...entries].sort(([,a],[,b])=>a.localeCompare(b)).map(([id,label])=>
    `<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(label)}</option>`).join('');
}

const setKey = entry => `${entry.lang}:${entry.setId}`;
function collection() {
  const languages=new Map(state.collection.map(c=>[c.lang,languageLabel(c.lang)]));
  const sets=new Map(state.collection.filter(c=>c.kind!=='sealed'&&c.setId)
    .map(c=>[setKey(c),`${cardSetTitle(c)} · ${languageLabel(c.lang)}`]));
  const expanded=kindFilter!=='all'||setFilter||valuationFilter||sort!=='recent';
  return `${heading('My collection',`${num(totals(state).quantity)} cards and sealed items`,button('Refresh prices','refresh','refresh','subtle')+button('Add sealed','discover-sealed','box','subtle')+button('Add cards','discover','plus','primary'))}
  <div class="toolbar collection-toolbar">
    <div class="search-field">${icon('search')}<input id="collection-search" aria-label="Search your collection" placeholder="Name, set or card number…" value="${esc(collectionQuery)}"></div>
    <div class="toolbar-group">
      <select id="binder-filter" aria-label="Filter by binder"><option value="all">All binders</option>${filterOptions(state.binders.map(b=>[b.id,b.name]),binderFilter)}</select>
      <select id="language-filter" aria-label="Filter by language"><option value="">All languages</option>${filterOptions(languages,languageFilter)}</select>
      <div class="view-toggle" aria-label="Collection view"><button data-view="grid" class="${view==='grid'?'active':''}" aria-label="Grid view" aria-pressed="${view==='grid'}">${icon('home')}</button><button data-view="list" class="${view==='list'?'active':''}" aria-label="List view" aria-pressed="${view==='list'}">${icon('list')}</button></div>
    </div>
    <details class="collection-extra-filters" ${expanded?'open':''}><summary>More filters and sort</summary><div class="toolbar-group">
      <select id="kind-filter" aria-label="Filter by item type"><option value="all">Cards &amp; sealed</option><option value="card" ${kindFilter==='card'?'selected':''}>Cards only</option><option value="sealed" ${kindFilter==='sealed'?'selected':''}>Sealed only</option></select>
      <select id="set-filter" aria-label="Filter by set"><option value="">All sets</option>${filterOptions(sets,setFilter)}</select>
      <select id="valuation-filter" aria-label="Filter by valuation"><option value="">All valuations</option><option value="missing" ${valuationFilter==='missing'?'selected':''}>Needs valuation</option><option value="personal" ${valuationFilter==='personal'?'selected':''}>Personal valuation</option></select>
      <select id="sort" aria-label="Sort collection"><option value="recent">Recently added</option><option value="value" ${sort==='value'?'selected':''}>Highest value</option><option value="difference" ${sort==='difference'?'selected':''}>Largest gain</option><option value="name" ${sort==='name'?'selected':''}>Name A–Z</option></select>
    </div></details>
  </div><div id="collection-results">${collectionResults()}</div>`;
}

const signedEuro = value => value===null?'—':`${value>0?'+':''}${euro(value)}`;
function collectionRows() {
  const normalize = value => value.normalize('NFKC').toLowerCase();
  const term=normalize(collectionQuery.trim());
  const rows=state.collection.filter(c=>
    (binderFilter==='all'||c.binderId===binderFilter) &&
    (kindFilter==='all'||c.kind===kindFilter) &&
    (!languageFilter||c.lang===languageFilter) &&
    (!setFilter||(c.kind!=='sealed'&&setKey(c)===setFilter)) &&
    (valuationFilter!=='missing'||effectivePrice(c)===null) &&
    (valuationFilter!=='personal'||c.manualValuation) &&
    (!term||normalize(`${c.name} ${catalogueCardTitle(c)} ${c.setName} ${cardSetTitle(c)} ${c.id} ${c.localId} ${c.productCode||''} ${c.edition||''}`).includes(term)));
  const value=c=>(effectivePrice(c)??0)*c.quantity;
  const delta=c=>effectivePrice(c)===null?-Infinity:value(c)-c.cost*c.quantity;
  if(sort==='value')return rows.sort((a,b)=>value(b)-value(a));
  if(sort==='difference')return rows.sort((a,b)=>delta(b)-delta(a));
  if(sort==='name')return rows.sort((a,b)=>a.name.localeCompare(b.name));
  return rows.sort((a,b)=>b.addedAt.localeCompare(a.addedAt));
}

function updateCollectionResults(reset=false) {
  if(reset){collectionPage=1;selectedEntries.clear();}
  const target=document.querySelector('#collection-results');
  if(target)target.innerHTML=collectionResults();
  updateSelection();
}

function updateSelection() {
  const count=document.querySelector('#selected-count');
  const move=document.querySelector('#move-selected');
  const form=document.querySelector('#collection-move-form');
  if(count)count.textContent=`${num(selectedEntries.size)} selected`;
  if(move)move.disabled=!selectedEntries.size;
  if(form)form.hidden=!selectedEntries.size;
  const toggle=document.querySelector('[data-action="select-visible"]');
  if(toggle)toggle.textContent=[...document.querySelectorAll('[data-select-entry]')].every(input=>input.checked)?'Deselect page':'Select page';
}

function collectionResults() {
  const rows=collectionRows();
  if(!rows.length) return empty('cards',state.collection.length?'No items found':'Your collection is empty',state.collection.length?'Change or clear the active filters.':'Search for a card or sealed product to add your first item.',state.collection.length?'Clear filters':'Find your first card',state.collection.length?'clear-filters':'discover');
  const pages=Math.ceil(rows.length/COLLECTION_PAGE_SIZE);
  collectionPage=Math.min(collectionPage,pages);
  const start=(collectionPage-1)*COLLECTION_PAGE_SIZE;
  const display=rows.slice(start,start+COLLECTION_PAGE_SIZE);
  const summary=totals({...state,collection:rows});
  const binders=new Map(state.binders.map(b=>[b.id,b.name]));
  const selectedPage=display.every(c=>selectedEntries.has(c.uid));
  return `<section class="collection-summary" aria-label="Filtered collection totals"><dl>
    <div><dt>Items</dt><dd>${num(summary.quantity)}</dd><small>${num(rows.length)} entries</small></div>
    <div><dt>Estimated value</dt><dd>${summary.pricedQuantity?euro(summary.value):'—'}</dd><small>${num(summary.pricedQuantity)} of ${num(summary.quantity)} valued</small></div>
    <div><dt>Purchase cost</dt><dd>${euro(summary.cost)}</dd></div>
    <div><dt>Estimated gain / loss</dt><dd class="${summary.profit>0?'positive':summary.profit<0?'negative':''}">${signedEuro(summary.pricedQuantity?summary.profit:null)}</dd><small>Valued items only</small></div>
  </dl></section>
  <div class="collection-actions">
    <button type="button" class="button subtle small-button" data-action="select-visible">${selectedPage?'Deselect page':'Select page'}</button>
    <span id="selected-count" role="status">${num(selectedEntries.size)} selected</span>
    <form id="collection-move-form" ${selectedEntries.size?'':'hidden'}><select name="binderId" aria-label="Destination binder" required><option value="">Choose a binder</option>${filterOptions(binders,'')}</select>
    <button id="move-selected" class="button subtle small-button" type="submit" ${selectedEntries.size?'':'disabled'}>Move selected</button></form>
    ${button('New binder','new-binder','folder','subtle small-button')}
  </div>
  ${view==='grid'? `<div class="card-grid collection-grid">${display.map(c=>cardTile(c,'collection')).join('')}</div>` :
  `<div class="table-scroll"><table class="collection-table"><thead><tr><th scope="col">Select</th><th scope="col">Item</th><th scope="col">Printing / condition</th><th scope="col">Qty</th><th scope="col">Cost / item</th><th scope="col">Value / item</th><th scope="col">Total value</th><th scope="col">Gain / loss</th></tr></thead><tbody>
  ${display.map(c=>{
    const unit=effectivePrice(c);
    const difference=unit===null?null:(unit-c.cost)*c.quantity;
    const title=catalogueCardTitle(c);
    return `<tr><td>${entryCheckbox(c)}</td><td><div class="table-card">${art(c)}<button data-entry="${esc(c.uid)}">${esc(title)}${title!==c.name?`<small lang="${esc(c.lang)}">${esc(c.name)}</small>`:''}<small>${esc(cardSetTitle(c))}${c.localId?` · #${esc(c.localId)}`:''} · ${esc(binders.get(c.binderId))}</small></button></div></td><td>${esc(identityLabel(c))}</td><td>${num(c.quantity)}</td><td>${euro(c.cost)}</td><td>${unit===null?'—':euro(unit)}<br>${priceBadge(c)}</td><td>${unit===null?'—':euro(unit*c.quantity)}</td><td class="${difference>0?'positive':difference<0?'negative':''}">${signedEuro(difference)}</td></tr>`;
  }).join('')}</tbody></table></div>`}
  ${pages>1?`<div class="pagination"><button class="button subtle small-button" data-action="collection-previous" ${collectionPage===1?'disabled':''}>Previous</button><span>Page ${collectionPage} of ${pages}</span><button class="button subtle small-button" data-action="collection-next" ${collectionPage===pages?'disabled':''}>Next</button></div>`:''}`;
}

function catalogueViewLanguage() {
  return lastSetRequest?.lang ?? (listingSets ? catalogueSetsLanguage : query ? searchLanguage : ALL_PRINTINGS);
}
function catalog() {
  const language=catalogueViewLanguage();
  const examples=['Blastoise','Charizard ex 151','Pikachu','Caramella Rara'];
  const setName=setView?catalogueSetName(setView.name,setView.id,language):'';
  const subtitle='Find Western (TCG) and Asian (OCG) editions by name or card ID. Open an edition to choose its language.';
  const setLanguage=listingSets||lastSetRequest
    ? `<label class="printing-language" for="catalog-lang"><span>Set language</span><select id="catalog-lang" aria-label="Set language">${CATALOGUE_LANGUAGES.map(({code,label})=>`<option value="${code}" ${language===code?'selected':''}>${label}</option>`).join('')}${!CATALOGUE_LANGUAGES.some(item=>item.code===language)?`<option value="${esc(language)}" selected>${esc(languageLabel(language))}</option>`:''}</select></label>` : '';
  return `${heading(setView?esc(setName):'Discover cards',setView?`${esc(languageLabel(language))} · ${esc(setView.id)}${setName!==setView.name?` · ${esc(setView.name)}`:''}`:subtitle)}
  <form id="catalog-form" class="toolbar"><div class="search-field">${icon('search')}<input id="catalog-query" type="search" aria-label="Search cards by name or catalogue ID" aria-controls="catalog-results" placeholder="Blastoise or a card ID…" value="${esc(catalogueInput)}" autocomplete="off" maxlength="100"></div><div class="toolbar-group">${setLanguage}<button class="button primary" type="submit">${icon('search')}Search</button></div></form>
  <div class="chips" id="catalog-examples" ${catalogueInput.trim()?'hidden':''}><button class="chip ${listingSets?'active':''}" data-action="browse-catalogue-sets">Browse sets</button>${examples.map(name=>`<button class="chip" data-search="${esc(name)}">${esc(name)}</button>`).join('')}${setView||listingSets?'<button class="chip" data-action="clear-search">Clear</button>':''}</div><div id="catalog-results" aria-busy="${searching||loadingMoreEditions}">${catalogResults()}</div>`;
}
function editionSetTitle(edition) {
  const {card,setName,region}=edition;
  if(setName)return catalogueSetName(setName,card.setId,card.lang);
  if(region==='tcg')return englishSetNames.get(card.setId?.toLowerCase())||card.setId||'Pokémon TCG';
  const code=card.setCode||card.setId;
  return code?.toLowerCase()==='sv2a'?'Pokémon Card 151':code||'Pokémon OCG';
}
function editionTile(edition) {
  const {card,region,key}=edition;
  const title=catalogueCardTitle(card), set=editionSetTitle(edition), number=card.localId?`#${card.localId}`:'';
  const label=[title,EDITION_LABELS[region],set,number].filter(Boolean).join(' · ');
  const owned=[...edition.printings.values()].some(row=>state.collection.some(saved=>saved.id===row.id&&saved.lang===row.lang));
  return `<article class="pokemon-card edition-card"><button class="card-open" data-edition="${esc(key)}" aria-label="View ${esc(label)}"><div class="card-art">${art(edition.art)}${owned?'<span class="card-badge">In your vault</span>':''}</div><div class="card-name">${esc(title)}</div><div class="card-set">${esc([set,number].filter(Boolean).join(' · '))}</div><div class="edition-card-footer"><span class="edition-region ${region}">${EDITION_LABELS[region]}</span>${icon('chevron')}</div></button></article>`;
}
function catalogResults() {
  if(searching) return skeletons();
  if(searchError) return empty('info','Couldn’t load the catalogue',esc(searchError),'Try again','retry-search');
  const language=catalogueViewLanguage();
  if(listingSets){
    if(!catalogueSets.length)return empty('sets','No sets available','This language has no sets in the source catalogue yet.','','');
    const display=catalogueSets.slice((searchPage-1)*CATALOGUE_PAGE_SIZE,searchPage*CATALOGUE_PAGE_SIZE);
    return `<div class="result-note"><span>${num(catalogueSets.length)} sets · ${esc(languageLabel(language))}</span></div><div class="set-grid">${display.map(set=>`<button class="set-tile" data-set="${esc(set.id)}" data-lang="${esc(language)}"><div class="set-tile-top">${icon('sets')}<span class="set-code">${esc(set.id)}</span></div><h3>${esc(catalogueSetName(set.name,set.id,language))}</h3>${catalogueSetName(set.name,set.id,language)!==set.name?`<p lang="${esc(language)}">${esc(set.name)}</p>`:''}${Number.isInteger(set.cardCount?.total)?`<p>${num(set.cardCount.total)} cards in the catalogue</p>`:''}</button>`).join('')}</div>${cataloguePagination(searchPage*CATALOGUE_PAGE_SIZE>=catalogueSets.length)}`;
  }
  if(!query&&!setView&&catalogueInput.trim())return empty('search','Keep typing','Enter at least two characters to search as you type.','','');
  const usingFeatured=!query&&!setView;
  const rows=usingFeatured?featured:searchResults;
  const availability=query&&searchUnavailable.length?`<p class="notice warning">Couldn’t search ${esc(searchUnavailable.map(languageLabel).join(', '))}. <button class="text-button" data-action="retry-search">Try again</button></p>`:'';
  if(!rows.length){
    if(language==='ko'&&searchPage===1){
      const alias=catalogueAlias(query,language);
      const url=new URL('https://pokemoncard.co.kr/cards');
      if(alias?.nativeName)url.searchParams.set('s',printedSearchName(alias,language));
      return empty('search','No cards found',`<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">Search the official Pokémon Korea catalogue</a> for more printings.`,'','');
    }
    return availability+empty('search','No cards found','Try the full Pokémon name or a card ID, or open the set to see the available prints.','Browse sets','browse-catalogue-sets');
  }
  if(query){
    const editions=groupCardEditions(rows,query);
    const scope=language===ALL_PRINTINGS?'':` · ${esc(languageLabel(language))}`;
    const loadMore=searchHasMore?`<div class="pagination"><button class="button subtle" data-action="more-editions" ${loadingMoreEditions?'disabled':''}>${loadingMoreEditions?'Loading editions…':searchMoreError?'Try again':'Load more editions'}</button></div>`:'';
    return `${availability}<div class="result-note"><span>Results for “${esc(query)}”${scope}</span><span>${loadingMoreEditions?'<span role="status">Checking more editions…</span>':`${num(editions.length)} editions`}</span></div><div class="card-grid collection-grid">${editions.map(editionTile).join('')}</div>${searchMoreError?`<p class="notice warning">${esc(searchMoreError)}</p>`:''}${loadMore}`;
  }
  const display=setView?rows.slice((searchPage-1)*CATALOGUE_PAGE_SIZE,searchPage*CATALOGUE_PAGE_SIZE):rows;
  return `<div class="result-note"><span>${usingFeatured?'Collector favorites · English cards':`${num(rows.length)} cards in ${esc(catalogueSetName(setView.name,setView.id,language))}`}</span></div><div class="card-grid collection-grid">${display.map(c=>cardTile(c)).join('')}</div>${usingFeatured?'<p class="card-footer-note">Featured snapshot dates are shown in card details.</p>':cataloguePagination(searchPage*CATALOGUE_PAGE_SIZE>=rows.length)}`;
}
function cataloguePagination(lastPage) {
  return `<div class="pagination"><button class="button subtle small-button" data-action="previous-page" ${searchPage===1?'disabled':''}>Previous</button><span>Page ${searchPage}</span><button class="button subtle small-button" data-action="next-page" ${lastPage?'disabled':''}>Next</button></div>`;
}
async function browseCatalogueSets() {
  const ticket=cancelCatalogueSearch();
  listingSets=true;setView=null;lastSetRequest=null;query='';catalogueInput='';searchPage=1;searching=true;searchError='';
  if(page==='catalog')render();
  try {
    const sets=await getSets(catalogueSetsLanguage);
    if(ticket===searchTicket)catalogueSets=sets.filter(set=>typeof set?.id==='string'&&typeof set.name==='string').reverse();
  }catch(error){if(ticket===searchTicket)searchError=error.message;}
  finally{if(ticket===searchTicket){searching=false;updateCatalog();}}
}

function cancelCatalogueSearch() {
  clearTimeout(catalogueSearchTimer);
  catalogueSearchTimer=undefined;
  loadingMoreEditions=false;
  return ++searchTicket;
}

function searchCatalogue(value,{debounce=false}={}) {
  catalogueInput=value;
  const input=document.querySelector('#catalog-query');
  if(input&&input.value!==value)input.value=value;
  const search=catalogueQuery(value.trim(),ALL_PRINTINGS);
  const autoSearch=debounce&&[...search.term].length>=2;
  const start=()=>{
    query=debounce&&!autoSearch?'':search.term;
    searchLanguage=search.lang;
    searchPage=1;
    return runSearch();
  };
  if(!autoSearch)return start();
  cancelCatalogueSearch();
  catalogueSearchTimer=setTimeout(start,CATALOGUE_SEARCH_DELAY);
  if(!searching){searching=true;updateCatalog();}
}

async function runSearch({append=false}={}) {
  const ticket=cancelCatalogueSearch();
  const leavingSet=Boolean(setView||lastSetRequest||listingSets);
  setView=null; lastSetRequest=null; listingSets=false; searchError='';
  searchMoreError='';
  const requestedPage=append?searchPage+1:1;
  searching=Boolean(query)&&!append;
  loadingMoreEditions=append;
  if(!append){searchResults=[];searchHasMore=false;searchUnavailable=[];searchPage=1;}
  if(leavingSet&&page==='catalog')render();
  else updateCatalog();
  if(!query)return;
  if(!englishSetNames.size){
    void getSets('en').then(sets=>{
      englishSetNames=new Map(sets.filter(set=>typeof set?.id==='string'&&typeof set.name==='string').map(set=>[set.id.toLowerCase(),set.name]));
      if(ticket===searchTicket&&!searching)updateCatalog();
    }).catch(()=>{});
  }
  try {
    let rows, hasMore, unavailable=[];
    if(searchLanguage===ALL_PRINTINGS){
      const result=await searchCardPrintings(query,requestedPage,append?undefined:cards=>{
        if(ticket!==searchTicket)return;
        searchResults=cards;searching=false;loadingMoreEditions=true;updateCatalog();
      });
      ({cards:rows,hasMore,unavailable}=result);
    }else{
      rows=await searchCards(query,searchLanguage,requestedPage);
      hasMore=rows.length>=CATALOGUE_PAGE_SIZE;
    }
    if(ticket!==searchTicket)return;
    searchResults=append?[...searchResults,...rows]:rows;
    searchHasMore=hasMore;searchUnavailable=append?[...new Set([...searchUnavailable,...unavailable])]:unavailable;searchPage=requestedPage;
  }
  catch(error){if(ticket!==searchTicket)return;if(append)searchMoreError=error.message;else searchError=error.message;}
  finally{if(ticket===searchTicket){searching=false;loadingMoreEditions=false;updateCatalog();}}
}
function updateCatalog() {
  const container=document.querySelector('#catalog-results');
  if(container){container.innerHTML=catalogResults();container.setAttribute('aria-busy',String(searching||loadingMoreEditions));}
  const select=document.querySelector('#catalog-lang');
  if(select)select.value=catalogueViewLanguage();
  const examples=document.querySelector('#catalog-examples');
  if(examples)examples.hidden=Boolean(catalogueInput.trim());
}
function selectCatalogueLanguage(value) {
  catalogueSetsLanguage=catalogueLanguage(value);
  try{localStorage.setItem('pocketvault.lang',catalogueSetsLanguage);}catch{}
}
async function browseSet(id,language) {
  const ticket=cancelCatalogueSearch();
  const setLanguage=catalogueSetLanguage(language||catalogueViewLanguage());
  listingSets=false;lastSetRequest={id,lang:setLanguage};query='';catalogueInput='';searchPage=1;searching=true;searchError='';setView=null;navigate('catalog');
  try {const data=await getSet(id,setLanguage);if(ticket!==searchTicket)return;setView=data;searchResults=data.cards.map(c=>({...c,lang:setLanguage,setId:data.id,setName:data.name}));}
  catch(error){if(ticket!==searchTicket)return;searchError=error.message;}
  finally{if(ticket===searchTicket){searching=false;if(page==='catalog')render();}}
}
function wishlist() {
  const reference=c=>effectivePrice({...c,manualValuation:null});
  const hit=c=>reference(c)!==null&&quoteStatus(cardOfferReference(c)||c.market)==='current'&&reference(c)<=c.target;
  const reached=state.wishlist.filter(hit).length;
  return `${heading('Good things are worth chasing.',`${state.wishlist.length} items on your wishlist${reached?` · ${reached} at or below your target`:'. Your next great find starts here.'}`,button('Refresh prices','refresh','refresh','subtle')+button('Find sealed','discover-sealed','box','subtle')+button('Find cards','discover','plus','primary'))}${state.wishlist.length?`<div class="notice">Targets use current market references for your selection. Older, unverified and personal valuations do not trigger a target. Checks are shown here when the app is open.</div><div class="wishlist-grid">${state.wishlist.map(c=>`<article class="wish-row">${art(c)}<div class="wish-name"><strong>${esc(catalogueCardTitle(c))}</strong>${catalogueCardTitle(c)!==c.name?`<p lang="${esc(c.lang)}">${esc(c.name)}</p>`:''}<p>${esc(cardSetTitle(c))}${c.localId?` · #${esc(c.localId)}`:''}</p><p>${esc(identityLabel(c))}</p><p>Provider updated ${esc(dateLabel(c.priceUpdated))}</p>${priceBadge({...c,manualValuation:null})}</div><div class="wish-price"><span>Market reference</span><strong>${euro(reference(c))}</strong></div><div class="wish-price"><span>Your target</span><strong>${euro(c.target)}</strong></div><span class="target-tag ${hit(c)?'hit':''}">${hit(c)?'Within your target':reference(c)===null?'No matched reference':quoteStatus(cardOfferReference(c)||c.market)!=='current'?'Refresh reference':`${euro(reference(c)-c.target)} above target`}</span><button class="icon-button" data-wish="${esc(c.uid)}" aria-label="Edit wishlist item ${esc(catalogueCardTitle(c))}">${icon('chevron')}</button></article>`).join('')}</div>`:empty('heart','Keep your next favorites close.','Save a card and its printing, then choose your target price.','Find a wishlist card','discover')}`;
}

function binders() {
  return `${heading('A place for every favorite.','Organize your cards and sealed products your way. Create as many binders as you need.',button('New binder','new-binder','plus','primary'))}<div class="set-grid">${state.binders.map(b=>{const rows=state.collection.filter(c=>c.binderId===b.id);const value=totals({...state,collection:rows});return `<button class="set-tile" data-binder="${esc(b.id)}"><div class="binder-cover">${rows.length?rows.slice(0,3).map(c=>art(c)).join(''):icon('folder')}</div><h3>${esc(b.name)}</h3><p>${num(value.quantity)} items · ${num(value.unique)} unique</p><div class="progress-labels" style="margin-top:18px"><span>Estimated value</span><strong>${euro(value.value)}</strong></div></button>`;}).join('')}</div>`;
}
function sets() {
  const groups=new Map();
  for(const card of state.collection){if(card.kind==='sealed'||!card.setId)continue;const key=`${card.lang}:${card.setId}`;if(!groups.has(key))groups.set(key,{...card,ids:new Set()});groups.get(key).ids.add(card.id);}
  return `${heading('One card closer.', 'Watch your sets come together, one discovery at a time.',button('Discover cards','discover','plus','primary'))}${groups.size?`<div class="notice">Progress counts unique card numbers in each language, including secret cards. Duplicate copies, foil variations, and condition do not increase set completion.</div><div class="set-grid">${[...groups.values()].map(s=>{const progress=s.setTotal?Math.min(100,s.ids.size/s.setTotal*100):0;return `<button class="set-tile" data-set="${esc(s.setId)}" data-lang="${esc(s.lang)}"><div class="set-tile-top">${icon('sets')}<span class="set-code">${esc(s.lang.toUpperCase())} · ${esc(s.setId.toUpperCase())}</span></div><h3>${esc(catalogueSetName(s.setName,s.setId,s.lang))}</h3><p>${num(s.ids.size)} unique cards collected</p><div class="progress"><span style="width:${progress}%"></span></div><div class="progress-labels"><span>${s.ids.size} / ${s.setTotal||'?'} cards</span><span>${s.setTotal?`${progress.toFixed(1)}%`:'Total unavailable'}</span></div></button>`;}).join('')}</div>`:empty('sets','Small discoveries. Complete collections.','Add cards to your vault to start tracking the sets you’re building.')}`;
}
function settings() {
  return `${heading('Your collection. Your data.','Keep a copy of what matters. Take it with you whenever you like.')}${recoveredRaw?`<div class="notice warning">Unreadable saved data is protected. ${button('Download recovery copy','recover',null,'small-button')} ${button('Start a new vault','resolve-recovery',null,'small-button')}</div>`:''}<div class="settings-grid"><section class="panel settings-card"><h2>${icon('download')}Back up your vault</h2><p>A JSON backup includes cards, sealed products, variants, grading, personal valuation histories, wishlist, binders, and collection totals. CSV exports your collection entries.</p><div class="settings-actions">${button('Download JSON','export-json','download','primary')}${button('Export CSV','export-csv','download','subtle')}${migrationBackup?button('Download pre-upgrade backup','migration-backup','download','subtle'):''}</div></section><section class="panel settings-card"><h2>${icon('upload')}Bring your collection along</h2><p>Restore a version 1 or 2 JSON backup, or merge a CSV export. Older entries keep their quantities and costs; their variant remains unspecified until you choose it.</p>${button('Import a file','import','upload','subtle')}</section><section class="panel settings-card"><h2>${icon('shield')}Your holdings stay on this device</h2><p>There is no application account. Quantities, costs, grading and personal valuations stay in this browser. Clearing browser data removes your vault.</p><p>Public card and sealed product identifiers are sent to the price service. Cloudflare stores shared market quotations and their history; it does not receive your holdings or purchase costs. Card searches go to TCGdex; sealed searches use the shared public catalogue.</p><p class="small">Export a JSON backup before changing browsers or site addresses.</p></section><section class="panel settings-card"><h2>${icon('refresh')}Shared price references</h2><p>${priceService===null?'Checking price service…':priceService.configured?'The shared price service is available.':'The shared price service is unavailable. Saved references remain visible.'}</p><p>Recently consulted cards are scheduled for daily checks. The sealed catalogue uses a shared daily feed. Both depend on source availability and service capacity. Opening or returning to the app checks your saved references when needed. A manual check respects the provider cooldown.</p>${button(refreshing?'Checking…':'Check saved references','refresh','refresh','subtle')}</section><section class="panel settings-card"><h2>${icon('chart')}Know what the numbers mean</h2><p>CardTrader offers apply to the displayed printing, language and condition. Market trends are for the card overall. Sealed references are EU retail asking prices; their language is unspecified. Shipping and taxes are excluded. A named variant is valued automatically only when its product and price metric have a reviewed mapping.</p><p>Add a personal per-item valuation where needed. It overrides the automatic reference in your total and survives price updates. Graded cards require a personal valuation.</p><p class="small">The public price history contains recorded provider observations. Your collection chart also includes changes to what you own; it is not a market-return chart.</p></section><section class="panel settings-card"><h2>${icon('info')}Made for collectors</h2><p>Monstertrade is independent of DarkDex, Nintendo, The Pokémon Company and TCGdex. Pokémon card names and artwork belong to their respective owners.</p><a href="https://tcgdex.dev/markets-prices" target="_blank" rel="noopener noreferrer">About the pricing source</a></section></div>`;
}

function modalShell(title,body,small=false) {
  modal.className=small?'modal-small':'';
  modal.innerHTML=`<div class="modal-header"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body">${body}</div>`;
  if(!modal.open)modal.showModal();
}
function closeModal(){++modalTicket;++modalHistoryTicket;activeImport?.abort();activeImport=null;modal.close();modalCard=null;modalEntry=null;modalWish=null;modalBundle=null;modalDraft=null;modalWarning='';modalEdition=null;pendingImport=null;}
function ensureMarket(card) {
  if(card.market)return card;
  const variants=(card.variants||card.variantOptions||[]).map(v=>({...v,quote:v.quote||normalizeQuote({amount:null,currency:'EUR',mapping:'unverified'})}));
  return {...card,variantId:card.variantId||null,variantLabel:card.variantLabel||'Unspecified variant',variants,market:normalizeQuote({amount:card.price??null,currency:'EUR',source:card.snapshot?'Bundled catalogue snapshot':'Cardmarket via TCGdex (catalogue)',metric:'trend',providerUpdatedAt:card.priceUpdated||null,mapping:'generic'})};
}
function priceFailure(card,message) {
  const prepared=ensureMarket(card);
  return {...prepared,market:{...prepared.market,lastAttemptAt:new Date().toISOString(),lastError:message}};
}
function renderEditionPrintings({checking=false,unavailable=[]}={}) {
  const edition=modalEdition;
  const title=catalogueCardTitle(edition.card);
  const description=[EDITION_LABELS[edition.region],editionSetTitle(edition),edition.card.localId?`#${edition.card.localId}`:''].filter(Boolean).join(' · ');
  const languages=CATALOGUE_LANGUAGES.flatMap(({code,label})=>{
    const card=edition.printings.get(code);
    if(!card)return [];
    const name=card.name!==title?`<span lang="${esc(code)}">${esc(card.name)}</span>`:'';
    return `<button class="button subtle edition-language" data-edition-language="${esc(code)}" aria-label="${esc(label)}"><span><strong>${esc(label)}</strong>${name}</span>${icon('chevron')}</button>`;
  }).join('');
  const status=checking?'<p class="form-hint" role="status">Checking available languages…</p>':unavailable.length?`<p class="notice warning">Couldn’t check ${esc(unavailable.map(languageLabel).join(', '))}. <button class="text-button" data-action="edition-languages">Try again</button></p>`:'';
  modalShell(title,`<p class="edition-description">${esc(description)}</p><h3 class="edition-language-heading">Choose a printing language</h3><div class="edition-language-list" role="group" aria-label="Printing languages">${languages}</div>${status}`,true);
}
async function openEdition(edition) {
  const ticket=++modalTicket;++modalHistoryTicket;
  modalCard=null;modalEntry=null;modalWish=null;modalBundle=null;modalDraft=null;
  modalEdition=edition;
  renderEditionPrintings({checking:Boolean(edition.lookup)});
  const {printings,unavailable}=await findEditionPrintings(edition);
  if(ticket!==modalTicket||!modal.open)return;
  modalEdition={...edition,printings};
  renderEditionPrintings({unavailable});
}
async function openCard(id,language='en',entry=null,wish=null,edition=null) {
  if(entry?.kind==='sealed'||wish?.kind==='sealed'){await openSealed(id,entry,wish);return;}
  const ticket=++modalTicket;++modalHistoryTicket;
  modalCard=null;modalBundle=null;modalWarning='';modalDraft=null;modalEntry=entry;modalWish=wish;modalMode=wish?'wish':'collect';modalEdition=edition;
  modalShell('Card details','<div class="loading"><span class="spinner"></span>Loading card and price references…</div>');
  const regional=isRegionalIdentity(id,language);
  const [details,prices]=await Promise.allSettled([
    entry||wish?Promise.resolve(structuredClone(entry||wish)):getCard(id,language),
    regional?null:getPrices(id,{lang:language}),
  ]);
  if(ticket!==modalTicket||!modal.open)return;
  if(details.status==='fulfilled'){
    const card=details.value;
    const result=edition?.printings.get(language)||searchResults.find(row=>row.id===card.id&&row.lang===card.lang);
    modalCard=ensureMarket({...card,pokemonName:card.pokemonName||result?.pokemonName});
  }
  else {
    const saved=featured.find(c=>c.id===id&&c.lang===language);
    if(!saved){modalShell('Couldn’t load this card',`<p class="muted">${esc(details.reason.message)}</p><div class="modal-actions">${button('Close','close-modal',null,'subtle')}</div>`);return;}
    modalCard=ensureMarket(saved);modalWarning='Showing bundled card details. '+details.reason.message;
  }
  if(prices.status==='fulfilled'){
    if(prices.value){modalBundle=prices.value;modalCard=applyMarketUpdate(modalCard,modalBundle);}
  }else{modalWarning=[modalWarning,prices.reason.message].filter(Boolean).join(' ');modalCard=priceFailure(modalCard,prices.reason.message);}
  renderCardModal();
}
async function openSealed(id=null,entry=null,wish=null) {
  const ticket=++modalTicket;++modalHistoryTicket;
  modalCard=null;modalBundle=null;modalDraft=null;modalWarning='';modalEntry=entry;modalWish=wish;modalMode=wish?'wish':'collect';
  if(!id){
    modalCard={kind:'sealed',id:`sealed-${crypto.randomUUID()}`,name:'',setName:'',setId:'',localId:'',image:'',lang:'und',productType:'booster-pack',edition:'',productCode:'',productUrl:'',variantId:null,grading:null,variants:[],manualValuation:null,valuationHistory:[],market:normalizeQuote({amount:null,currency:'EUR',mapping:'unverified',source:'No automatic sealed source',metric:'store-low'}),price:null};
    renderSealedModal();return;
  }
  modalCard=entry||wish?structuredClone(entry||wish):null;
  if(!/^sealed-tcgp-[1-9]\d*-eu$/.test(id)){renderSealedModal();return;}
  modalShell('Sealed product','<div class="loading"><span class="spinner"></span>Loading product and retail reference…</div>');
  try{
    const product=await getSealedProduct(id);
    if(ticket!==modalTicket||!modal.open)return;
    modalCard=modalCard?applySealedMarketUpdate(modalCard,product):product;
    modalWarning=product.lastError||'';
  }catch(error){
    if(ticket!==modalTicket||!modal.open)return;
    if(!modalCard){modalShell('Couldn’t load this product',`<p class="muted">${esc(error.message)}</p><div class="modal-actions">${button('Close','close-modal',null,'subtle')}</div>`);return;}
    modalCard=priceFailure(modalCard,error.message);modalWarning=error.message;
  }
  renderSealedModal();
}
function captureSealedDraft() {
  const form=document.querySelector('#sealed-form');if(!form)return;
  modalDraft={...modalDraft,...Object.fromEntries(new FormData(form).entries()),costEdited:form.elements.cost?.dataset.edited==='true'||modalDraft?.costEdited};
}
function renderSealedModal() {
  const c=modalCard;if(!c)return;
  const wish=modalMode==='wish';
  const preview={...c,lang:modalDraft?.lang||c.lang,condition:modalDraft?.condition||c.condition,image:modalDraft?.image??c.image};
  modalShell(c.name||'Add a sealed product',`${modalWarning?`<div class="notice warning">${esc(modalWarning)}</div>`:''}<div class="sealed-modal-intro">${imageURL(preview)?`<a class="product-photo-link" href="${esc(imageURL(preview,true))}" target="_blank" rel="noopener noreferrer" aria-label="Open full-size product image">${art(preview)}</a>`:art(preview)}<div><span class="eyebrow">SEALED PRODUCT</span><p>${esc(SEALED_TYPES.find(t=>t.id===c.productType)?.label||'Sealed')} · ${c.lang==='und'?'Language unspecified':esc(c.lang.toUpperCase())}</p>${imageURL(preview)?`<p class="photo-source">${esc(productPhotoSource(preview))} · Select to view full size.</p>`:''}</div></div>${sealedPricePanel(preview)}<form id="sealed-form">${sealedFields({...c,quantity:modalEntry?.quantity??1,cost:modalEntry?.cost!==undefined?Number(modalEntry.cost.toFixed(2)):0},state.binders)}${wish?`<div class="form-field"><label for="sealed-target">Your target price (€)</label><input id="sealed-target" name="target" type="number" min="0" max="1000000000" step="0.01" value="${esc(modalDraft?.target??modalWish?.target??c.market?.amount??0)}" required></div><p class="form-hint">Targets use the current EU retail reference, with language unspecified. Personal valuations never trigger a target.</p>`:''}<div id="form-error" class="form-error" role="alert"></div><div class="modal-actions"><button class="button primary" type="submit">${icon(wish?'heart':'plus')}${wish?'Save to wishlist':modalEntry?'Save changes':'Add to collection'}</button></div></form>${sealedValuationHistory(c)}<div class="modal-subtle"><button data-action="toggle-sealed-mode">${wish?'Add to collection instead':'Save to wishlist instead'}</button>${(wish&&modalWish)||(!wish&&modalEntry)?'<button data-action="remove-card">Remove</button>':''}</div>`);
  const form=document.querySelector('#sealed-form');
  if(wish){form.querySelector('.personal-fields')?.setAttribute('hidden','');for(const name of ['quantity','cost','condition','binderId','manualAmount','manualNote','manualUrl','manualDate']){const field=form.elements[name];if(field){field.disabled=true;field.closest('.form-field')?.setAttribute('hidden','');}}}
  if(modalDraft)for(const [name,value] of Object.entries(modalDraft))if(form.elements[name]&&!form.elements[name].disabled)form.elements[name].value=value;
  if(modalDraft?.manualAmount&&!wish)form.querySelector('.personal-fields')?.setAttribute('open','');
  if(modalDraft?.costEdited&&form.elements.cost)form.elements.cost.dataset.edited='true';
}
function saveSealed(form) {
  try{
    const data=new FormData(form),linked=/^sealed-tcgp-[1-9]\d*-eu$/.test(modalCard.id);
    const image=String(data.get('image')||'').trim();
    if(image&&!safePhotoURL(image))throw new Error('Use a direct HTTPS image URL without a username or password.');
    const selected={...modalCard,lang:String(data.get('lang')||modalCard.lang||'und'),image};
    if(!linked)for(const key of ['name','productType','setName','edition','productCode','productUrl'])selected[key]=String(data.get(key)||'').trim();
    const latest=(modalMode==='wish'?state.wishlist:state.collection).find(c=>c.uid===(modalMode==='wish'?modalWish?.uid:modalEntry?.uid));
    if(latest&&Date.parse(latest.market?.lastAttemptAt||'')>Date.parse(selected.market?.lastAttemptAt||'1970-01-01')){selected.market=latest.market;selected.price=latest.price;selected.priceUpdated=latest.priceUpdated;selected.lastValidMarket=latest.lastValidMarket;}
    if(modalMode==='wish'){
      const existing=modalWish||state.wishlist.find(w=>w.kind==='sealed'&&w.id===selected.id&&w.lang===selected.lang&&w.edition===selected.edition);
      const next={...selected,manualValuation:null,uid:existing?.uid||crypto.randomUUID(),target:Number(data.get('target')),addedAt:existing?.addedAt||new Date().toISOString()};
      commit({...state,wishlist:existing?state.wishlist.map(w=>w.uid===existing.uid?next:w):[...state.wishlist,next]});closeModal();toast('Sealed product saved to your wishlist.');return;
    }
    const amountText=String(data.get('manualAmount')||'').trim();let manualValuation=null;
    if(amountText!==''){
      const amount=Number(amountText),note=String(data.get('manualNote')||'').trim(),url=String(data.get('manualUrl')||'').trim(),date=String(data.get('manualDate')||'');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date||date>new Date().toISOString().slice(0,10))throw new Error('Choose a valid observation date, today or earlier.');
      const old=modalCard.manualValuation;
      manualValuation={amount,currency:'EUR',note,url,updatedAt:old&&old.amount===amount&&old.note===note&&old.url===url&&old.updatedAt.slice(0,10)===date?old.updatedAt:`${date}T00:00:00.000Z`};
    }
    const cost=modalEntry&&!form.elements.cost.dataset.edited?modalEntry.cost:Number(data.get('cost'));
    const details={quantity:Number(data.get('quantity')),cost,condition:data.get('condition'),binderId:data.get('binderId'),manualValuation};
    const edited=Boolean(modalEntry);
    commit(edited?updateEntry(state,modalEntry.uid,{...selected,...details}):addCard(state,{...selected,manualValuation},details),true,'collection');
    closeModal();toast(edited?'Sealed product and valuation history updated.':'Sealed product added to your collection.');
  }catch(error){document.querySelector('#form-error').textContent=error.message;}
}
async function refreshSealedPrice() {
  if(!modalCard||modalCard.kind!=='sealed')return;
  captureSealedDraft();const ticket=modalTicket;
  const trigger=document.querySelector('[data-action="refresh-sealed-price"]');if(trigger){trigger.disabled=true;trigger.textContent='Checking…';}
  try{const product=await getSealedProduct(modalCard.id,{force:true});if(ticket!==modalTicket||!modal.open)return;modalCard=applySealedMarketUpdate(modalCard,product);modalWarning=product.lastError||'';}
  catch(error){if(ticket!==modalTicket||!modal.open)return;modalCard=priceFailure(modalCard,error.message);modalWarning=error.message;}
  if(ticket===modalTicket&&modal.open){captureSealedDraft();renderSealedModal();}
}
async function showSealedHistory() {
  if(!modalCard)return;const ticket=++modalHistoryTicket,cardTicket=modalTicket;
  const target=document.querySelector('#sealed-public-history');if(!target)return;
  target.innerHTML='<p class="form-hint">Loading recorded retail prices…</p>';
  try{const result=await getSealedHistory(modalCard.id,90);if(ticket===modalHistoryTicket&&cardTicket===modalTicket&&modal.open)target.innerHTML=sealedPublicHistory(result);}
  catch(error){if(ticket===modalHistoryTicket&&cardTicket===modalTicket&&modal.open)target.innerHTML=`<p class="notice warning">${esc(error.message)}</p>`;}
}
function captureCardDraft() {
  const form=document.querySelector('#card-form');if(!form||!modalCard)return;
  const data=new FormData(form);
  modalDraft={...modalDraft,...Object.fromEntries(data.entries())};
  modalDraft.costEdited=form.elements.cost?.dataset.edited==='true'||modalDraft.costEdited;
  const variantId=String(data.get('variantId')||'')||null;
  if(variantId!==modalCard.variantId){
    const choice=(modalCard.variants||[]).find(v=>v.id===variantId);
    modalCard={...modalCard,variantId,variantLabel:choice?.label||'Unspecified variant',market:normalizeQuote({amount:null,currency:'EUR',mapping:variantId?'unverified':'generic'}),lastValidMarket:null,price:null,priceUpdated:null};
    if(modalBundle)modalCard=applyMarketUpdate(modalCard,modalBundle);
  }
}
function renderCardModal() {
  const c=modalCard;if(!c)return;
  const title=catalogueCardTitle(c);
  const e=modalEntry,w=modalWish,d=modalDraft||{},wishMode=modalMode==='wish';
  const regional=isRegionalIdentity(c.id,c.lang);
  const setCode=regional?c.setCode:c.setId;
  const market=regional
    ? '<p class="notice">This regional printing can be saved with a personal valuation.</p>'
    : marketPanel({...c,condition:wishMode?'Near Mint':d.condition||c.condition},modalBundle);
  const changeLanguage=modalEdition?'<button class="button subtle small-button edition-change" data-action="edition-languages">Change printing language</button>':'';
  modalShell(title,`${changeLanguage}${modalWarning?`<div class="notice warning">${esc(modalWarning)}</div>`:''}<div class="modal-columns"><div class="modal-art-column">${imageURL(c)?`<a href="${esc(imageURL(c,true))}" target="_blank" rel="noopener noreferrer" aria-label="Open full-size card image"><img class="modal-image" src="${esc(imageURL(c,true))}" alt="${esc(title)}"></a>`:icon('cards')}<p class="modal-card-meta">${title!==c.name?`<span lang="${esc(c.lang)}">${esc(c.name)}</span><br>`:''}${esc(catalogueSetName(c.setName,c.setId,c.lang))}${setCode&&marketLanguage(c.lang)!=='en'?` · ${esc(setCode)}`:''}<br>#${esc(c.localId)} · ${esc(languageLabel(c.lang))}<br>${esc(c.rarity)}</p></div><div><div id="market-panel">${market}</div><form id="card-form">${variantFields(c)}${wishMode?`<div class="form-field"><label for="target-price">Your target price (€)</label><input id="target-price" name="target" type="number" min="0" max="1000000000" step="0.01" value="${esc(d.target??w?.target??c.price??0)}" required></div><p class="form-hint">${marketLanguage(c.lang)==='en'?'Targets use current market references.':'This target is saved for reference until a language-specific market quote is available.'}</p>`:`<div class="form-row"><div class="form-field"><label for="card-quantity">Quantity</label><input id="card-quantity" name="quantity" type="number" min="1" max="1000000" step="1" value="${esc(d.quantity??e?.quantity??1)}" required></div><div class="form-field"><label for="card-cost">Cost per card (€)</label><input id="card-cost" name="cost" type="number" min="0" max="1000000000" step="0.01" value="${esc(d.cost??(e?.cost!==undefined?Number(e.cost.toFixed(2)):0))}" ${d.costEdited?'data-edited="true"':''} required></div></div><div class="form-row"><div class="form-field"><label for="card-condition">Condition</label><select id="card-condition" name="condition">${CONDITIONS.map(condition=>`<option ${condition===(d.condition??e?.condition??'Near Mint')?'selected':''}>${condition}</option>`).join('')}</select></div><div class="form-field"><label for="card-binder">Binder</label><select id="card-binder" name="binderId">${state.binders.map(b=>`<option value="${esc(b.id)}" ${b.id===(d.binderId??e?.binderId??state.binders[0].id)?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div></div><p class="form-hint">Purchase cost is per card and stays separate from its valuation.</p>${personalFields(c)}`}<div id="form-error" class="form-error" role="alert"></div><div class="modal-actions"><button class="button primary" type="submit">${icon(wishMode?'heart':'plus')}${wishMode?w?'Save target':'Save to wishlist':e?'Save changes':'Add to collection'}</button></div></form><div class="modal-subtle"><button data-action="toggle-modal-mode">${wishMode?'Add to collection instead':'Save to wishlist instead'}</button>${(wishMode&&w)||(!wishMode&&e)?'<button data-action="remove-card">Remove</button>':''}</div></div></div>`);
  const form=document.querySelector('#card-form');
  for(const name of ['gradingCompany','gradingGrade','manualAmount','manualNote','manualUrl'])if(Object.hasOwn(d,name)&&form.elements[name])form.elements[name].value=d[name];
  if(d.manualAmount)form.querySelector('.personal-fields')?.setAttribute('open','');
}
function saveCard(form) {
  try {
    const data=new FormData(form);
    captureCardDraft();
    const company=String(data.get('gradingCompany')||'').trim(),grade=String(data.get('gradingGrade')||'').trim();
    if(Boolean(company)!==Boolean(grade))throw new Error('Enter both grading company and grade, or leave both blank for an ungraded card.');
    const grading=company?{company,grade}:null;
    let selected={...modalCard,grading};
    const latest=(modalMode==='wish'?state.wishlist:state.collection).find(c=>c.uid===(modalMode==='wish'?modalWish?.uid:modalEntry?.uid));
    if(latest&&latest.variantId===selected.variantId&&Date.parse(latest.market?.lastAttemptAt||latest.market?.fetchedAt||'')>Date.parse(selected.market?.lastAttemptAt||selected.market?.fetchedAt||'1970-01-01')){
      selected={...selected,market:latest.market,lastValidMarket:latest.lastValidMarket,price:latest.price,priceUpdated:latest.priceUpdated,variants:latest.variants};
    }
    if(latest?.cardOffers&&(!selected.cardOffers||latest.cardOffers.observedAt>selected.cardOffers.observedAt))selected={...selected,cardOffers:latest.cardOffers};
    if(modalMode==='wish') {
      const target=Number(data.get('target'));
      const existing=modalWish||state.wishlist.find(w=>w.id===selected.id&&w.lang===selected.lang&&w.variantId===selected.variantId&&JSON.stringify(w.grading)===JSON.stringify(grading));
      const next={...selected,manualValuation:null,uid:existing?.uid||crypto.randomUUID(),target,addedAt:existing?.addedAt||new Date().toISOString()};
      const wishlist=existing?state.wishlist.map(w=>w.uid===existing.uid?next:w):[...state.wishlist,next];
      commit({...state,wishlist});closeModal();toast(existing?'Wishlist target updated.':'Added to your wishlist.');
    } else {
      const amountText=String(data.get('manualAmount')||'').trim();
      let manualValuation=null;
      if(amountText!==''){
        const amount=Number(amountText),note=String(data.get('manualNote')||'').trim(),url=String(data.get('manualUrl')||'').trim();
        const old=modalCard.manualValuation;
        manualValuation={amount,currency:'EUR',note,url,updatedAt:old&&old.amount===amount&&old.note===note&&old.url===url?old.updatedAt:new Date().toISOString()};
      }
      const costField=form.elements.cost;
      const cost=modalEntry&&!costField.dataset.edited?modalEntry.cost:Number(data.get('cost'));
      const details={quantity:Number(data.get('quantity')),cost,condition:data.get('condition'),binderId:data.get('binderId'),grading,manualValuation};
      const edited=Boolean(modalEntry);
      commit(edited?updateEntry(state,modalEntry.uid,{...selected,...details}):addCard(state,{...selected,manualValuation},details),true,'collection');
      closeModal();toast(edited?'Card details updated.':'Card added to your collection.');
    }
  }catch(error){document.querySelector('#form-error').textContent=error.message;}
}
async function refreshCardPrice() {
  if(!modalCard)return;
  captureCardDraft();const ticket=modalTicket,variant=modalCard.variantId;
  const trigger=document.querySelector('[data-action="refresh-card-price"]');if(trigger){trigger.disabled=true;trigger.textContent='Checking…';}
  try {const bundle=await getPrices(modalCard.id,{force:true,lang:modalCard.lang});if(ticket!==modalTicket||!modal.open)return;modalBundle=bundle;modalCard=applyMarketUpdate(modalCard,bundle);modalWarning='';}
  catch(error){if(ticket!==modalTicket||!modal.open)return;modalCard=priceFailure(modalCard,error.message);modalWarning=error.message;}
  if(ticket===modalTicket&&modal.open){captureCardDraft();renderCardModal();if(variant!==modalCard.variantId)++modalHistoryTicket;}
}
async function showPriceHistory(days=90) {
  if(!modalCard||![30,90,365].includes(days))return;
  const ticket=++modalHistoryTicket,cardTicket=modalTicket,card=modalCard;
  const target=document.querySelector('#card-price-history');target.innerHTML='<p class="form-hint">Loading recorded prices…</p>';
  try{const history=await getPriceHistory(card.id,card.variantId,days,card.lang);if(ticket!==modalHistoryTicket||cardTicket!==modalTicket||!modal.open||card.variantId!==modalCard?.variantId)return;target.innerHTML=historyPanel(history,days);}
  catch(error){if(ticket===modalHistoryTicket&&cardTicket===modalTicket&&modal.open)target.innerHTML=`<p class="notice warning">${esc(error.message)}</p>`;}
}

function removeCard() {
  const wishMode=modalMode==='wish', entry=wishMode?modalWish:modalEntry;
  if(!entry)return;
  const key=wishMode?'wishlist':'collection';
  commit(wishMode?{...state,wishlist:state.wishlist.filter(c=>c.uid!==entry.uid)}:removeEntry(state,entry.uid),!wishMode);
  closeModal();toast(entry.kind==='sealed'?'Sealed product removed.':'Card removed.',()=>{commit({...state,[key]:[...state[key],entry]},!wishMode);toast('Item restored.');});
}
function newBinder() {
  modalShell('Make room for a new binder',`<form id="binder-form"><div class="form-field"><label for="binder-name">Binder name</label><input id="binder-name" name="name" placeholder="The ones I grew up with" maxlength="100" required autofocus></div><div id="form-error" class="form-error" role="alert"></div><div class="modal-actions"><button type="submit" class="button primary">${icon('folder')}Create binder</button></div></form>`,true);
}
function download(text,filename,type) {
  const url=URL.createObjectURL(new Blob([text],{type}));
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const filename = extension => `monstertrade-${new Date().toISOString().slice(0,10)}.${extension}`;
function importDialog() {
  modalShell('Bring your collection along',`<p class="muted">Choose a Monstertrade backup or collection export. Earlier PocketVault backups are also supported.</p><div class="modal-actions">${button('Choose JSON or CSV','choose-file','upload','primary')}</div><div class="import-help"><strong>JSON backup</strong> restores your whole vault and replaces current data.<br><strong>CSV export</strong> adds collection rows and merges matching items. Importing the same file twice adds the quantities twice.<br><br>For a complete backup, use JSON. Files must be under 20 MB.</div>`,true);
}
async function readImport(file) {
  if(!file)return;
  activeImport?.abort();
  const controller=new AbortController(),before=state;
  activeImport=controller;pendingImport=null;
  try{
    if(file.size>20*1024*1024)throw new Error('Choose a file smaller than 20 MB.');
    const json=file.name.toLowerCase().endsWith('.json');
    if(!json&&!file.name.toLowerCase().endsWith('.csv'))throw new Error('Choose a .json or .csv file.');
    modalShell('Checking your file',`<p class="muted" role="status">Reading and checking your collection. Your saved vault will stay as it is until you review and apply the import.</p><div class="modal-actions">${button('Cancel','close-modal',null,'subtle')}</div>`,true);
    const source=await file.text();
    if(controller.signal.aborted)return;
    const imported=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./import-worker.js',import.meta.url),{type:'module'});
      const finish=(error,value)=>{worker.terminate();controller.signal.removeEventListener('abort',abort);error?reject(error):resolve(value);};
      const abort=()=>finish(new DOMException('Import cancelled.','AbortError'));
      controller.signal.addEventListener('abort',abort,{once:true});
      worker.onmessage=event=>finish(event.data.error?new Error(event.data.error):null,event.data);
      worker.onerror=()=>finish(new Error('The file could not be checked. Please try again.'));
      worker.onmessageerror=()=>finish(new Error('The file could not be read. Please try again.'));
      try{worker.postMessage({source,format:json?'json':'csv',current:json?undefined:before});}catch(error){finish(error);}
    });
    if(controller.signal.aborted)return;
    if(!json&&state!==before)throw new Error('Your collection changed while this file was being checked. Choose the file again to merge into your latest collection.');
    pendingImport={state:imported.state,json,before};
    modalShell('Review your import',`<p class="muted">${json?'This backup will replace your collection, wishlist, binders, and history.':'This CSV will merge into your current collection. The resulting vault will contain:'}</p><div class="import-help"><strong>${num(imported.quantity)} items</strong> in ${num(pendingImport.state.collection.length)} entries<br>${pendingImport.state.wishlist.length} wishlist cards · ${pendingImport.state.binders.length} binders</div>${json?'<p class="form-hint" style="margin-top:16px">Download a backup of your current vault first if you want to keep both.</p>':''}<div class="modal-actions">${button('Back up current vault','export-json','download','subtle')}${button(json?'Restore backup':'Merge collection','apply-import','check','primary')}</div>`,true);
  }catch(error){if(controller.signal.aborted)return;pendingImport=null;modalShell('This file couldn’t be imported',`<p class="muted">${esc(error.message)}</p><div class="modal-actions">${button('Choose another file','choose-file','upload','primary')}</div>`,true);}
  finally{if(activeImport===controller)activeImport=null;}
}
const hasSharedPrice=card=>card.kind==='sealed'?/^sealed-tcgp-[1-9]\d*-eu$/.test(card.id):!isRegionalIdentity(card.id,card.lang);
let refreshCursor=0;
async function refreshPrices({automatic=false}={}) {
  if(refreshing)return;
  if(recoveredRaw||migrationPending){if(!automatic)toast('Back up and resolve the saved-data warning before refreshing.');return;}
  const eligible=[...state.collection,...state.wishlist].filter(hasSharedPrice);
  const keyFor=c=>c.kind==='sealed'?`sealed:${c.id}`:`card:${cardOfferKey(c.id,c.lang)||marketCardKey(c.id,marketLanguage(c.lang))}`;
  const identities=new Map(eligible.map(c=>[keyFor(c),{id:c.id,kind:c.kind||'card',lang:c.lang}]));
  const all=[...identities.keys()];
  if(!all.length){if(!automatic)toast('No linked market references to refresh. Open a custom sealed product to record a new valuation.');return;}
  const cards=all.slice(refreshCursor,refreshCursor+100);
  refreshCursor=refreshCursor+cards.length>=all.length?0:refreshCursor+cards.length;
  refreshing=true;lastAutoRefresh=Date.now();
  if(!automatic)toast('Checking shared price references…');
  const updates=new Map(),errors=new Map();let index=0;
  async function worker(){while(index<cards.length){const key=cards[index++],{id,kind,lang}=identities.get(key);try{updates.set(key,await (kind==='sealed'?getSealedProduct(id,{force:!automatic}):getPrices(id,{force:!automatic,lang})));}catch(error){errors.set(key,error.message);}}}
  await Promise.all(Array.from({length:Math.min(3,cards.length)},worker));
  try{
    const merge=c=>updates.has(keyFor(c))?(c.kind==='sealed'?applySealedMarketUpdate(c,updates.get(keyFor(c))):applyMarketUpdate(c,{...updates.get(keyFor(c)),cardId:c.id})):errors.has(keyFor(c))?priceFailure(c,errors.get(keyFor(c))):c;
    commit({...state,collection:state.collection.map(merge),wishlist:state.wishlist.map(merge)},state.collection.length>0,'prices');
    const failed=errors.size+[...updates.values()].filter(b=>b.lastError&&!b.cardOffers).length;
    if(!automatic)toast(`${updates.size} item references checked.${failed?` ${failed} could not update; previous observations retained.`:''}${all.length>100?' Up to 100 items per check; check again to continue.':''}`);
  }catch(error){toast(error.message);}finally{refreshing=false;if(page==='settings')render();}
}
function maybeRefreshPrices() {
  if(document.visibilityState!=='visible'||modal.open||refreshing||recoveredRaw||migrationPending||Date.now()-lastAutoRefresh<3_600_000)return;
  const due=[...state.collection,...state.wishlist].filter(hasSharedPrice).some(c=>!c.market?.fetchedAt||Date.now()-Date.parse(c.market.fetchedAt)>86_400_000||Boolean(c.market.lastError));
  if(due)void refreshPrices({automatic:true});
}

document.addEventListener('click',async event=>{
  const el=event.target.closest('button,a,[data-action]');if(!el)return;
  try{
    if(el.dataset.page){
      event.preventDefault();
      const fromMore=el.closest?.('.more-pages');
      const fromMobile=fromMore||el.closest?.('.mobile-nav');
      if(fromMore)closeModal();
      navigate(el.dataset.page);
      if(fromMobile)document.querySelector('#main')?.focus({preventScroll:true});
      return;
    }
    if(el.dataset.entry){const c=state.collection.find(c=>c.uid===el.dataset.entry);if(c)await openCard(c.id,c.lang,c);return;}
    if(el.dataset.wish){const c=state.wishlist.find(c=>c.uid===el.dataset.wish);if(c)await openCard(c.id,c.lang,null,c);return;}
    if(el.dataset.edition){
      const edition=groupCardEditions(searchResults,query).find(item=>item.key===el.dataset.edition);
      if(edition)await openEdition(edition);
      return;
    }
    if(el.dataset.editionLanguage){
      const card=modalEdition?.printings.get(el.dataset.editionLanguage);
      if(card)await openCard(card.id,card.lang,null,null,modalEdition);
      return;
    }
    if(el.dataset.card){await openCard(el.dataset.card,el.dataset.lang);return;}
    if(el.dataset.sealed){await openSealed(el.dataset.sealed);return;}
    if(el.dataset.set){await browseSet(el.dataset.set,el.dataset.lang);return;}
    if(el.dataset.binder){binderFilter=el.dataset.binder;collectionQuery='';kindFilter='all';languageFilter='';setFilter='';valuationFilter='';collectionPage=1;selectedEntries.clear();navigate('collection');return;}
    if(el.dataset.view){view=el.dataset.view;render();return;}
    if(el.dataset.range){range=el.dataset.range;render();return;}
    if(el.dataset.historyDays){await showPriceHistory(Number(el.dataset.historyDays));return;}
    if(el.dataset.search){await searchCatalogue(el.dataset.search);return;}
    switch(el.dataset.action){
      case 'discover':navigate('catalog');break;
      case 'discover-sealed':navigate('sealed');break;
      case 'new-sealed':await openSealed();break;
      case 'retry-sealed':await runSealedSearch();break;
      case 'sealed-previous':if(sealedPage>1){sealedPage--;await runSealedSearch();}break;
      case 'sealed-next':sealedPage++;await runSealedSearch();break;
      case 'toggle-sealed-mode':captureSealedDraft();modalMode=modalMode==='wish'?'collect':'wish';renderSealedModal();break;
      case 'refresh-sealed-price':await refreshSealedPrice();break;
      case 'sealed-price-history':await showSealedHistory();break;
      case 'focus-search':navigate('catalog');document.querySelector('#catalog-query')?.focus();break;
      case 'more-navigation':
        modalShell('More',`<nav class="more-pages" aria-label="More sections">${morePages.map(id=>pageButton(id)).join('')}</nav>`,true);
        modal.classList.add('navigation-sheet');
        break;
      case 'install-app':
        if(!await promptInstallation()&&!isInstalled()){
          modalShell('Install Monstertrade',`<div class="install-instructions">
            <p><strong>iPhone or iPad</strong> In Safari, choose Share, then Add to Home Screen. Enable Open as Web App if shown.</p>
            <p><strong>Android or desktop</strong> Look for Install app in Chrome or Edge. On macOS Safari, choose File, then Add to Dock.</p>
            <p>Launch Monstertrade from its new icon to open it in its own window.</p>
          </div>`,true);
        }
        break;
      case 'close-modal':closeModal();break;
      case 'edition-languages':if(modalEdition)await openEdition(modalEdition);break;
      case 'new-binder':newBinder();break;
      case 'toggle-modal-mode':captureCardDraft();modalMode=modalMode==='wish'?'collect':'wish';renderCardModal();break;
      case 'remove-card':removeCard();break;
      case 'clear-filters':binderFilter='all';kindFilter='all';collectionQuery='';languageFilter='';setFilter='';valuationFilter='';collectionPage=1;selectedEntries.clear();render();break;
      case 'select-visible': {
        const inputs=[...document.querySelectorAll('[data-select-entry]')];
        const select=inputs.some(input=>!input.checked);
        for(const input of inputs){input.checked=select;if(select)selectedEntries.add(input.dataset.selectEntry);else selectedEntries.delete(input.dataset.selectEntry);}
        updateSelection();
        break;
      }
      case 'collection-previous':if(collectionPage>1){collectionPage--;updateCollectionResults();}break;
      case 'collection-next':collectionPage++;updateCollectionResults();break;
      case 'browse-catalogue-sets':await browseCatalogueSets();break;
      case 'clear-search':await searchCatalogue('');break;
      case 'retry-search':if(listingSets)await browseCatalogueSets();else if(lastSetRequest)await browseSet(lastSetRequest.id,lastSetRequest.lang);else if(query)await runSearch();else{searchError='';render();}break;
      case 'previous-page':if(searchPage>1&&(setView||listingSets)){searchPage--;updateCatalog();}break;
      case 'next-page':if(setView||listingSets){searchPage++;updateCatalog();}break;
      case 'more-editions':if(query&&searchHasMore&&!loadingMoreEditions)await runSearch({append:true});break;
      case 'refresh':await refreshPrices();break;
      case 'refresh-card-price':await refreshCardPrice();break;
      case 'price-history':await showPriceHistory();break;
      case 'migration-backup':download(migrationBackup,'monstertrade-before-v2.json','application/json');break;
      case 'import':importDialog();break;
      case 'choose-file':document.querySelector('#import-file').click();break;
      case 'apply-import':{if(!pendingImport)break;const before=state,next=pendingImport;if(!next.json&&before!==next.before)throw new Error('Your collection changed after this preview. Choose the file again before merging.');commit(next.state,!next.json);closeModal();toast('Your collection is ready.',()=>{commit(before);toast('Previous collection restored.');});break;}
      case 'export-json':download(JSON.stringify(state,null,2),filename('json'),'application/json');toast('Your complete vault backup is ready.');break;
      case 'export-csv':download(exportCSV(state),filename('csv'),'text/csv;charset=utf-8');toast('Collection exported. Use JSON to include your wishlist and history.');break;
      case 'recover':download(recoveredRaw,'monstertrade-recovery.json','application/json');break;
      case 'resolve-recovery':modalShell('Start a new vault?',`<p class="muted">Download the recovery copy first to keep your old data. Starting a new vault will replace the unreadable saved data in this browser.</p><div class="modal-actions">${button('Download recovery copy','recover','download','subtle')}${button('Start new vault','confirm-recovery',null,'primary')}</div>`,true);break;
      case 'confirm-recovery':recoveredRaw='';commit(emptyState());closeModal();toast('Your new vault is ready.');break;
      case 'undo':{const action=undoAction;undoAction=null;if(action)action();break;}
    }
  }catch(error){toast(error.message||'Something went wrong. Please try again.');}
});
document.addEventListener('submit',event=>{
  if(event.target.id==='catalog-form'){
    event.preventDefault();
    void searchCatalogue(document.querySelector('#catalog-query').value);
  }
  if(event.target.id==='card-form'){event.preventDefault();saveCard(event.target);}
  if(event.target.id==='sealed-form'){event.preventDefault();saveSealed(event.target);}
  if(event.target.id==='sealed-search-form'){event.preventDefault();const data=new FormData(event.target);sealedQuery=String(data.get('query')||'').trim();sealedType=String(data.get('type')||'');sealedPage=1;void runSealedSearch();}
  if(event.target.id==='collection-move-form'){
    event.preventDefault();
    const binderId=new FormData(event.target).get('binderId');
    const binder=state.binders.find(b=>b.id===binderId);
    if(!binder||!selectedEntries.size)return;
    const before=state;
    let moved=0;
    const collection=state.collection.map(entry=>{
      if(!selectedEntries.has(entry.uid)||entry.binderId===binderId)return entry;
      moved++;
      return {...entry,binderId};
    });
    try {
      if(!moved){toast('The selected items are already in this binder.');return;}
      selectedEntries.clear();
      commit({...state,collection});
      toast(`Moved ${num(moved)} ${moved===1?'entry':'entries'} to ${binder.name}.`,()=>{commit(before);toast('Items moved back.');});
    }catch(error){toast(error.message);}
  }
  if(event.target.id==='binder-form'){
    event.preventDefault();const name=new FormData(event.target).get('name').trim();
    try{if(!name)throw new Error('Give your binder a name.');commit({...state,binders:[...state.binders,{id:crypto.randomUUID(),name}]});closeModal();toast('Your new binder is ready.');}
    catch(error){document.querySelector('#form-error').textContent=error.message;}
  }
});
document.addEventListener('input',event=>{
  if(event.target.id==='catalog-query'){
    if(event.isComposing){catalogueInput=event.target.value;cancelCatalogueSearch();}
    else void searchCatalogue(event.target.value,{debounce:true});
  }
  if(event.target.id==='collection-search'){collectionQuery=event.target.value;updateCollectionResults(true);}
  if(['card-cost','sealed-cost'].includes(event.target.id))event.target.dataset.edited='true';
});
document.addEventListener('compositionend',event=>{
  if(event.target.id==='catalog-query')void searchCatalogue(event.target.value,{debounce:true});
});
document.addEventListener('change',event=>{
  if(['sealed-lang','sealed-condition'].includes(event.target.id)&&modalCard?.kind==='sealed'){
    captureSealedDraft();
    const preview={...modalCard,lang:modalDraft.lang||modalCard.lang,condition:modalDraft.condition||modalCard.condition};
    // Replace only the source panel; keep form controls and unsaved notes intact.
    const old=document.querySelector('#modal .market-estimate');
    if(old){const host=document.createElement('div');host.innerHTML=sealedPricePanel(preview);old.replaceWith(host.querySelector('.market-estimate'));}
  }
  if(event.target.id==='card-variant'){captureCardDraft();++modalHistoryTicket;renderCardModal();}
  if(event.target.id==='card-condition'&&modalCard?.cardOffers){
    captureCardDraft();
    document.querySelector('#market-panel').innerHTML=marketPanel({...modalCard,condition:modalDraft.condition},modalBundle);
  }
  if(event.target.id==='binder-filter'){binderFilter=event.target.value;updateCollectionResults(true);}
  if(event.target.id==='kind-filter'){kindFilter=event.target.value;updateCollectionResults(true);}
  if(event.target.id==='language-filter'){languageFilter=event.target.value;updateCollectionResults(true);}
  if(event.target.id==='set-filter'){setFilter=event.target.value;updateCollectionResults(true);}
  if(event.target.id==='valuation-filter'){valuationFilter=event.target.value;updateCollectionResults(true);}
  if(event.target.id==='sort'){sort=event.target.value;collectionPage=1;updateCollectionResults();}
  if(event.target.dataset?.selectEntry){
    const uid=event.target.dataset.selectEntry;
    if(event.target.checked)selectedEntries.add(uid);else selectedEntries.delete(uid);
    updateSelection();
  }
  if(event.target.id==='catalog-lang'){
    selectCatalogueLanguage(event.target.value);event.target.value=catalogueSetsLanguage;
    void browseCatalogueSets();
  }
  if(event.target.id==='import-file'){readImport(event.target.files[0]);event.target.value='';}
});
document.addEventListener('keydown',event=>{
  if(event.key==='/'&&!modal.open&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)){event.preventDefault();navigate('catalog');document.querySelector('#catalog-query')?.focus();}
});
modal.addEventListener('cancel',closeModal);
window.addEventListener('hashchange',()=>{page=pages[location.hash.slice(1)]?location.hash.slice(1):'dashboard';render();if(page==='sealed'&&!sealedResult&&!sealedLoading)void runSealedSearch();});
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE_KEY)return;
  try{state=event.newValue?normalizeState(JSON.parse(event.newValue)):emptyState();selectedEntries.clear();closeModal();render();toast('Your vault was updated in another tab.');}
  catch{toast('Another tab saved unreadable data. Export your current vault before closing.');}
});
document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement){const img=event.target;img.hidden=true;img.parentElement?.classList.add('art-unavailable');}},true);

setupInstallation(()=>{
  const button=document.querySelector('[data-action="install-app"]');
  if(button)button.hidden=true;
});
render();
if(page==='sealed')void runSealedSearch();
try {const response=await fetch('./featured.json');if(response.ok)featured=await response.json();if(page==='dashboard')render();else if(page==='catalog')updateCatalog();}catch{}
if(state.collection.length&&!recoveredRaw&&!migrationPending){try{commit(state,true,'visit');}catch{}}
priceServiceHealth().then(result=>{priceService=result;if(page==='settings')render();}).catch(()=>{priceService={configured:false};if(page==='settings')render();});
document.addEventListener('visibilitychange',maybeRefreshPrices);
window.addEventListener('online',()=>{lastAutoRefresh=0;maybeRefreshPrices();});
setTimeout(maybeRefreshPrices,1200);
