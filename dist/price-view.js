import { quoteStatus } from './pricing.js';
import { effectivePrice, priceCoverage } from './model.js';
import { sealedIdentity } from './sealed-view.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = amount => amount == null ? 'Unavailable' : new Intl.NumberFormat('en-IE', {style:'currency',currency:'EUR'}).format(amount);
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(value)) : 'Unknown';
const statusLabels = {current:'Current reference',stale:'Older reference',missing:'No quotation',unverified:'Needs verification',error:'Update failed'};

export function priceBadge(card) {
  if(card.manualValuation) return '<span class="price-tag personal">Personal valuation</span>';
  if(card.kind==='sealed'){
    if(effectivePrice(card)===null)return '<span class="price-tag caution">Sealed · valuation needed</span>';
    const status=quoteStatus(card.market);
    return `<span class="price-tag ${status==='current'?'':'caution'}">${status==='error'?'Update failed':status==='stale'?'Older retail reference':'EU retail reference'}</span>`;
  }
  if(card.grading) return '<span class="price-tag caution">Graded · valuation needed</span>';
  const quote=card.market;
  const status=quote?quoteStatus(quote):'unverified';
  return `<span class="price-tag ${status==='current'?'':'caution'}">${esc(statusLabels[status]||'Needs verification')}${quote?.mapping==='generic'?' · generic':''}</span>`;
}

export function identityLabel(card) {
  if(card.kind==='sealed')return sealedIdentity(card);
  return [card.variantLabel||'Unspecified variant',card.grading?`${card.grading.company} ${card.grading.grade}`:card.condition,card.lang?.toUpperCase()].filter(Boolean).join(' · ');
}

export function coveragePanel(state) {
  const c=priceCoverage(state);
  if(!c.quantity)return '';
  return `<section class="price-coverage" aria-label="Valuation coverage"><div><strong>${c.pricedQuantity} / ${c.quantity} items valued</strong><span>Card references, sealed retail prices and personal valuations</span></div><dl><div><dt>Personal</dt><dd>${c.manualQuantity}</dd></div><div><dt>Generic card reference</dt><dd>${c.genericQuantity}</dd></div><div><dt>Older data</dt><dd>${c.staleQuantity}</dd></div><div><dt>Unpriced</dt><dd>${c.unpricedQuantity}</dd></div></dl><p>Categories can overlap. Prices do not account for condition or a specific language. Sealed references are store asking prices. Open an item to inspect its source.</p></section>`;
}

export function marketPanel(card, bundle=null) {
  const q=card.market;
  const generic=bundle?.reference;
  const previous=card.lastValidMarket;
  const status=q?quoteStatus(q):'unverified';
  const product=q?.productId;
  return `<div class="market-estimate"><span class="eyebrow">MARKET REFERENCE · EUR</span><strong>${money(q?.amount ?? card.price)}</strong><div class="price-badges"><span class="price-tag ${status==='current'?'':'caution'}">${esc(statusLabels[status]||'Needs verification')}</span><span class="price-tag">${q?.mapping==='matched'?'Variant matched':q?.mapping==='generic'?'Generic card reference':'Variant mapping unverified'}</span></div><dl class="quote-details"><div><dt>Source</dt><dd>${esc(q?.source||'Imported reference')}</dd></div><div><dt>Provider date</dt><dd>${date(q?.providerUpdatedAt||card.priceUpdated)}</dd></div><div><dt>Last successful check</dt><dd>${date(q?.fetchedAt)}</dd></div><div><dt>Last attempt</dt><dd>${date(q?.lastAttemptAt)}</dd></div><div><dt>Metric</dt><dd>${esc(q?.metric||'legacy')}</dd></div></dl><p>Market-wide reference. No adjustment for language, condition, or grading.</p>${q?.lastError?`<p class="price-warning">${esc(q.lastError)}</p>`:''}${card.variantId&&q?.amount==null&&generic?.amount!=null?`<p class="price-warning">Generic card reference: ${money(generic.amount)}. It is not assigned to this variant or included in its valuation.</p>`:''}${q?.amount==null&&previous?.amount!=null?`<p>Previous observation: ${money(previous.amount)} · ${date(previous.providerUpdatedAt)}. Excluded from the current total.</p>`:''}${product?`<a href="https://www.cardmarket.com/en/Pokemon/Products?idProduct=${encodeURIComponent(product)}" target="_blank" rel="noopener noreferrer">Check the marketplace product</a>`:''}<div class="price-panel-actions"><button type="button" class="text-button" data-action="refresh-card-price">Check reference</button><button type="button" class="text-button" data-action="price-history">Price history</button></div></div><div id="card-price-history" aria-live="polite"></div>${card.manualValuation?`<div class="personal-summary"><strong>Personal valuation: ${money(effectivePrice(card))}</strong><p>Used in your collection total. Updated ${date(card.manualValuation.updatedAt)}.</p></div>`:card.grading?'<div class="notice warning">This is a graded card. Add a personal valuation to include it in the total; the reference above is for an ungraded card.</div>':''}`;
}

export function variantFields(card) {
  const variants=card.variants||[];
  const unknown=card.variantId&&!variants.some(v=>v.id===card.variantId);
  return `<div class="form-field"><label for="card-variant">Variant / printing</label><select id="card-variant" name="variantId"><option value="">Unspecified variant · generic reference</option>${unknown?`<option value="${esc(card.variantId)}" selected>${esc(card.variantLabel||card.variantId)} · saved variant</option>`:''}${variants.map(v=>`<option value="${esc(v.id)}" ${card.variantId===v.id?'selected':''}>${esc(v.label)}</option>`).join('')}</select><p class="form-hint">Choose the printing on your card. A listed variant does not guarantee an available quotation.</p></div><div class="form-row"><div class="form-field"><label for="grading-company">Grading company</label><input id="grading-company" name="gradingCompany" maxlength="40" placeholder="Ungraded (leave blank)" value="${esc(card.grading?.company||'')}"></div><div class="form-field"><label for="grading-grade">Grade</label><input id="grading-grade" name="gradingGrade" maxlength="20" placeholder="e.g. 10" value="${esc(card.grading?.grade||'')}"></div></div>`;
}

export function personalFields(card) {
  const m=card.manualValuation;
  return `<details class="personal-fields" ${m?'open':''}><summary>Personal valuation (optional)</summary><p>Use your own per-card estimate for a specific condition or grade. Automatic updates will preserve it. Leave the amount blank to use the market reference.</p><div class="form-field"><label for="personal-amount">Your value per card (€)</label><input id="personal-amount" name="manualAmount" type="number" min="0" max="1000000000" step="0.01" value="${m?.amount??''}" placeholder="Use market reference"></div><div class="form-field"><label for="personal-note">Reason or comparable sale</label><textarea id="personal-note" name="manualNote" maxlength="1000" rows="2" placeholder="Why this value fits your card">${esc(m?.note||'')}</textarea></div><div class="form-field"><label for="personal-url">Source link (optional)</label><input id="personal-url" name="manualUrl" type="url" maxlength="2000" value="${esc(m?.url||'')}" placeholder="https://…"></div>${m?`<p>Last changed ${date(m.updatedAt)}. Clear the amount to remove this valuation.</p>`:''}</details>`;
}

export function historyPanel(result) {
  const points=result.points||[];
  if(!points.length)return '<section class="quote-history"><h3>Price history</h3><p>No observations for this selection yet. History starts with the first available quotation; missing dates are not filled in.</p></section>';
  const width=480,height=130,pad=28;
  const times=points.map(p=>Date.parse(p.date));
  const lo=Math.min(...times),span=Math.max(...times)-lo;
  const max=Math.max(...points.map(p=>p.amount),0.01)*1.15;
  const dots=points.map((p,i)=>[pad+(span?(times[i]-lo)/span:.5)*(width-2*pad),height-pad-(p.amount/max)*(height-2*pad)]);
  return `<section class="quote-history"><h3>Public price history · EUR</h3><p>${points.length} daily observation${points.length===1?'':'s'} · ${result.variantId&&result.variantId!=='generic'?'selected variant':'generic card reference'}</p><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Recorded daily price observations">${dots.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#b294ff"><title>${esc(points[i].date)}: ${money(points[i].amount)}</title></circle>`).join('')}<text x="${points.length===1?width/2:pad}" text-anchor="${points.length===1?'middle':'start'}" y="${height-5}">${esc(points[0].date)}</text>${points.length>1?`<text text-anchor="end" x="${width-pad}" y="${height-5}">${esc(points.at(-1).date)}</text>`:''}</svg><div class="history-table-wrap"><table><thead><tr><th>Observation</th><th>Price</th><th>Provider date</th></tr></thead><tbody>${points.slice(-15).reverse().map(p=>`<tr><td>${esc(p.date)}</td><td>${money(p.amount)}</td><td>${date(p.providerUpdatedAt)}</td></tr>`).join('')}</tbody></table></div><p>Latest 15 observations shown in the table. Up to ${result.retentionDays||365} days retained. This is market history, independent of your collection quantities.</p></section>`;
}
