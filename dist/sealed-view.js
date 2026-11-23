import { SEALED_TYPES, SEALED_CONDITIONS, effectivePrice } from './model.js';
import { quoteStatus } from './pricing.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value) : 'Unavailable';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value)) : 'Unknown';
const day = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
const languages = [['und', 'Not specified'], ['en', 'English'], ['it', 'Italian'], ['ja', 'Japanese'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['zh', 'Chinese'], ['ko', 'Korean']];
const linked = entry => /^sealed-tcgp-[1-9]\d{0,14}-eu$/.test(entry.id || '');
function safeURL(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function sourceLink(value, label = 'View source') {
  const url = safeURL(value);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
}
const option = (value, label, selected) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
const field = (label, name, value, extra = '') => `<div class="form-field"><label for="sealed-${name}">${esc(label)}</label><input id="sealed-${name}" name="${name}" value="${esc(value)}" ${extra}></div>`;

export function sealedIdentity(entry) {
  const type = SEALED_TYPES.find(item => item.id === entry.productType)?.label || 'Sealed product';
  const language = entry.lang === 'und' || !entry.lang ? 'Language not specified' : entry.lang.toUpperCase();
  return [type, entry.edition, language, entry.condition].filter(Boolean).join(' · ');
}

export function sealedAttribution() {
  return '<p class="sealed-attribution"><a href="https://tcgprices.app/data" target="_blank" rel="noopener noreferrer">Sealed price data from TCG Prices</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>. Filtered to Pokémon products and EU prices.</p>';
}

/** Form fields only. The parent owns submission, unsaved drafts and actions. */
export function sealedFields(entry, binders = []) {
  const locked = linked(entry);
  const readOnly = locked ? 'readonly' : '';
  const m = entry.manualValuation;
  const lang = entry.lang || 'und';
  const languageOptions = languages.some(([code]) => code === lang) ? languages : [...languages, [lang, lang.toUpperCase()]];
  return `${locked ? '<p class="form-hint">Catalogue identity is fixed so this reference stays attached to the exact product. Use a custom product for a different edition.</p>' : ''}
    ${field('Product name', 'name', entry.name || '', `required maxlength="300" ${readOnly}`)}
    <div class="form-row"><div class="form-field"><label for="sealed-productType">Product type</label><select id="sealed-productType" name="productType" ${locked ? 'disabled' : ''}>${SEALED_TYPES.map(type => option(type.id, type.label, entry.productType || 'other')).join('')}</select></div>
    <div class="form-field"><label for="sealed-lang">Product language</label><select id="sealed-lang" name="lang">${languageOptions.map(([code, label]) => option(code, label, lang)).join('')}</select></div></div>
    ${field('Set / collection', 'setName', entry.setName || '', `maxlength="300" ${readOnly}`)}
    ${field('Edition / packaging variant', 'edition', entry.edition || '', `maxlength="200" placeholder="e.g. Pokémon Center edition" ${readOnly}`)}
    <div class="form-row">${field('Product code', 'productCode', entry.productCode || '', `maxlength="100" ${readOnly}`)}${field('Product link', 'productUrl', entry.productUrl || '', `type="url" maxlength="2048" placeholder="https://…" ${readOnly}`)}</div>
    ${field('Product image URL (optional)', 'image', entry.image || '', 'type="url" maxlength="2000" placeholder="https://…/product.jpg"')}<p class="form-hint">Use a direct HTTPS image link. Leave it blank to use the catalogue photo when available. This link is saved with your local collection and backups.</p>
    <div class="form-row">${field('Quantity', 'quantity', entry.quantity ?? 1, 'type="number" required min="1" max="1000000" step="1"')}${field('Cost per product (€)', 'cost', entry.cost ?? 0, 'type="number" required min="0" max="1000000000" step="0.01"')}</div>
    <div class="form-row"><div class="form-field"><label for="sealed-condition">Packaging condition</label><select id="sealed-condition" name="condition">${SEALED_CONDITIONS.map(value => option(value, value, entry.condition || SEALED_CONDITIONS[0])).join('')}</select></div>
    <div class="form-field"><label for="sealed-binderId">Binder</label><select id="sealed-binderId" name="binderId">${binders.map(binder => option(binder.id, binder.name, entry.binderId || 'main')).join('')}</select></div></div>
    <p class="form-hint">Quantity counts sealed products, not the packs or cards inside. Purchase cost is per sealed product.</p>
    <details class="personal-fields" ${m ? 'open' : ''}><summary>Personal valuation (optional)</summary><p>Add your own per-product value for its language, edition or packaging condition. It is kept separately from purchase cost and survives automatic price checks.</p>
    <div class="form-row">${field('Your value per product (€)', 'manualAmount', m?.amount ?? '', 'type="number" min="0" max="1000000000" step="0.01" placeholder="Use available retail reference"')}${field('Valuation date', 'manualDate', day(m?.updatedAt), 'type="date"')}</div>
    <div class="form-field"><label for="sealed-manualNote">Reason or comparable sale</label><textarea id="sealed-manualNote" name="manualNote" maxlength="2000" rows="2">${esc(m?.note || '')}</textarea></div>
    ${field('Valuation source link', 'manualUrl', m?.url || '', 'type="url" maxlength="2048" placeholder="https://…"')}
    <p class="form-hint">Saved changes create a dated personal observation on this device. Clear the amount to stop overriding the automatic reference; previous personal observations remain in the history.</p></details>`;
}

export function sealedPricePanel(entry) {
  const q = entry.market;
  const hasPublic = linked(entry);
  const status = q ? quoteStatus(q) : 'missing';
  const labels = { current: 'Current reference', stale: 'Older reference', error: 'Update failed', missing: 'No quotation', unverified: 'Needs verification' };
  const specific = entry.lang && entry.lang !== 'und';
  const excluded = !entry.manualValuation && effectivePrice(entry) === null && q?.amount != null;
  return `<div class="market-estimate"><span class="eyebrow">${hasPublic ? 'EU RETAIL REFERENCE · EUR' : 'CUSTOM SEALED PRODUCT'}</span><strong>${hasPublic ? money(q?.amount) : 'Personal valuation available'}</strong>
    ${hasPublic ? `<div class="price-badges"><span class="price-tag ${status === 'current' ? '' : 'caution'}">${esc(labels[status] || 'No quotation')}</span><span class="price-tag">Lowest in-stock store price</span></div>
    <dl class="quote-details"><div><dt>Source</dt><dd>${esc(q?.source || 'TCGPrices · EU retail')}</dd></div><div><dt>Provider date</dt><dd>${date(q?.providerUpdatedAt)}</dd></div><div><dt>Last successful check</dt><dd>${date(q?.fetchedAt)}</dd></div><div><dt>Last attempt</dt><dd>${date(q?.lastAttemptAt)}</dd></div><div><dt>Market</dt><dd>EU · EUR</dd></div><div><dt>Printing language</dt><dd>Not specified by source</dd></div></dl>
    <p>This is a retailer asking price for a new sealed product, not a resale estimate or a completed sale. Shipping and taxes are excluded.</p>
    ${specific ? '<p class="price-warning">This source does not identify the printing language. Add a personal valuation for your selected language; this reference is not used automatically.</p>' : '<p>Language is not specified by this source. Check that the listing matches your product before relying on its price.</p>'}
    ${excluded && !specific ? '<p class="price-warning">This reference is excluded from the total for the selected packaging or edition. Add a personal valuation.</p>' : ''}
    ${q?.lastError || entry.lastError ? `<p class="price-warning">${esc(q?.lastError || entry.lastError)}</p>` : ''}
    ${sourceLink(entry.productUrl, 'Check the product comparison')}
    <div class="price-panel-actions"><button type="button" class="text-button" data-action="refresh-sealed-price">Check retail reference</button><button type="button" class="text-button" data-action="sealed-price-history">Public price history</button></div>`
      : '<p>Add a personal valuation and its date to track this product. Custom products are not matched to public prices automatically.</p>'}
    </div><div id="sealed-public-history" aria-live="polite"></div>
    ${entry.manualValuation ? `<div class="personal-summary"><strong>Personal valuation: ${money(entry.manualValuation.amount)}</strong><p>Used in your collection total. Dated ${date(entry.manualValuation.updatedAt)}.</p></div>` : ''}
    ${hasPublic ? sealedAttribution() : ''}`;
}

export function sealedValuationHistory(entry) {
  const points = Array.isArray(entry.valuationHistory) ? entry.valuationHistory.slice().sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) : [];
  if (!points.length) return '<section class="quote-history"><h3>Your valuation history · EUR</h3><p>No personal observations yet. Save a dated personal valuation to start a history on this device.</p></section>';
  return `<section class="quote-history"><h3>Your valuation history · EUR</h3><p>${points.length} personal observation${points.length === 1 ? '' : 's'}. Stored only in this browser.</p><div class="history-table-wrap"><table><thead><tr><th>Date</th><th>Per-product value</th><th>Note / source</th></tr></thead><tbody>${points.slice(-20).reverse().map(point => `<tr><td>${date(point.updatedAt)}</td><td>${money(point.amount)}</td><td>${esc(point.note || '')}${point.url ? ` ${sourceLink(point.url)}` : ''}</td></tr>`).join('')}</tbody></table></div><p>Latest 20 observations shown. These are your own estimates, separate from public store prices and collection totals.</p></section>`;
}

export function sealedPublicHistory(result) {
  const points = Array.isArray(result.points) ? result.points : [];
  const error = result.lastError ? `<p class="price-warning">${esc(result.lastError)}</p>` : '';
  if (!points.length) return `<section class="quote-history"><h3>Public retail price history · EUR</h3>${error}<p>No public observations yet. History starts with the first acquired quotation; missing dates are not filled in.</p>${sealedAttribution()}</section>`;
  return `<section class="quote-history"><h3>Public retail price history · EUR</h3>${error}<p>${points.length} daily observation${points.length === 1 ? '' : 's'} · lowest in-stock EU store prices.</p><div class="history-table-wrap"><table><thead><tr><th>Observation</th><th>Retail price</th><th>Provider date</th></tr></thead><tbody>${points.slice(-15).reverse().map(point => `<tr><td>${esc(point.date)}</td><td>${money(point.amount)}</td><td>${date(point.providerUpdatedAt)}</td></tr>`).join('')}</tbody></table></div><p>Latest 15 observations shown. Up to 365 days retained. These are retailer asking prices, independent of your quantity and personal valuations.</p>${sealedAttribution()}</section>`;
}
