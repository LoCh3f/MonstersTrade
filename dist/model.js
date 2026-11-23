/** Immutable collection operations. Prices and purchase costs are per card, in EUR. */
export const CONDITIONS = Object.freeze(['Near Mint', 'Excellent', 'Good', 'Played']);
const MAX_ROWS = 100000;
const MAX_MONEY = 1e9;
const MAX_QUANTITY = 1e6;
const CSV_COLUMNS = ['id', 'name', 'localId', 'image', 'setId', 'setName', 'setTotal', 'rarity', 'price', 'priceUpdated', 'lang', 'quantity', 'cost', 'condition', 'binderId', 'binderName', 'addedAt'];

export function emptyState() {
  return { version: 1, collection: [], wishlist: [], binders: [{ id: 'main', name: 'My collection' }], history: [] };
}

function fail(message) { throw new Error(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}
function text(value, label, fallback = '', maximum = 500) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > maximum || value.includes('\u0000')) fail(`${label} must be text of at most ${maximum} characters.`);
  return value;
}
function requiredText(value, label, maximum = 200) {
  const result = text(value, label, '', maximum);
  if (!result.trim()) fail(`${label} is required.`);
  return result;
}
function number(value, label, { maximum = MAX_MONEY, integer = false, minimum = 0 } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    fail(`${label} must be ${integer ? 'an integer' : 'a number'} between ${minimum} and ${maximum}.`);
  }
  return value;
}
function list(value, label) {
  if (!Array.isArray(value) || value.length > MAX_ROWS) fail(`${label} must be an array with at most ${MAX_ROWS} entries.`);
  return value;
}
function uniqueId() {
  return globalThis.crypto?.randomUUID?.() || `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function timestamp(value, label, fallback = new Date().toISOString()) {
  const result = text(value, label, fallback, 50);
  if (result && !Number.isFinite(Date.parse(result))) fail(`${label} must be a valid date.`);
  return result;
}
function cardMetadata(input) {
  object(input, 'Card');
  const lang = text(input.lang, 'Language', 'en', 10);
  if (!/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(lang)) fail('Card language must be a language code such as en or it.');
  const image = text(input.image, 'Card image', '', 2000);
  if (image && !/^(https?:\/\/|\.?\/?assets\/)/i.test(image)) fail('Card image must be an HTTP(S) URL or a local assets path.');
  return {
    id: requiredText(input.id, 'Card ID'),
    name: requiredText(input.name, 'Card name', 300),
    localId: text(input.localId, 'Card number', '', 100),
    image,
    setId: text(input.setId, 'Set ID', '', 200),
    setName: text(input.setName, 'Set name', 'Unknown set', 300),
    setTotal: input.setTotal === undefined || input.setTotal === null ? 0 : number(input.setTotal, 'Set size', { integer: true, maximum: MAX_ROWS }),
    rarity: text(input.rarity, 'Rarity', 'Unknown', 150),
    price: input.price === undefined || input.price === null ? null : number(input.price, 'Market price'),
    priceUpdated: timestamp(input.priceUpdated, 'Price date', ''),
    lang,
  };
}
function entryDetails(input, binders) {
  const condition = input.condition ?? 'Near Mint';
  if (!CONDITIONS.includes(condition)) fail('Choose a supported card condition.');
  const binderId = input.binderId ?? 'main';
  if (!binders.some(binder => binder.id === binderId)) fail('The selected binder does not exist.');
  return {
    quantity: number(input.quantity ?? 1, 'Quantity', { integer: true, minimum: 1, maximum: MAX_QUANTITY }),
    cost: number(input.cost ?? 0, 'Purchase cost'),
    condition,
    binderId,
  };
}
function assertUnique(entries, label) {
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.uid)) fail(`${label} contains a duplicate entry ID.`);
    ids.add(entry.uid);
  }
}

/** Validate a JSON backup before replacing current data. Unknown fields are discarded. */
export function normalizeState(input) {
  object(input, 'Backup');
  if (input.version !== 1) fail('This is not a supported PocketVault backup (version 1 required).');
  const binders = list(input.binders, 'Binders').map(binder => {
    object(binder, 'Binder');
    return { id: requiredText(binder.id, 'Binder ID'), name: requiredText(binder.name, 'Binder name', 100) };
  });
  if (!binders.length) fail('A backup must contain at least one binder.');
  if (new Set(binders.map(binder => binder.id)).size !== binders.length) fail('Binder IDs must be unique.');
  const collection = list(input.collection, 'Collection').map(entry => {
    object(entry, 'Collection entry');
    if (entry.quantity === undefined || entry.cost === undefined) fail('Every collection entry needs a quantity and purchase cost.');
    return {
      ...cardMetadata(entry),
      uid: requiredText(entry.uid, 'Entry ID'),
      ...entryDetails(entry, binders),
      addedAt: timestamp(entry.addedAt, 'Date added'),
    };
  });
  const wishlist = list(input.wishlist, 'Wishlist').map(entry => {
    object(entry, 'Wishlist entry');
    return {
      ...cardMetadata(entry),
      uid: requiredText(entry.uid, 'Wishlist entry ID'),
      target: number(entry.target, 'Target price'),
      addedAt: timestamp(entry.addedAt, 'Date added'),
    };
  });
  assertUnique(collection, 'Collection');
  assertUnique(wishlist, 'Wishlist');
  const seenDates = new Set();
  const history = list(input.history, 'History').map(snapshot => {
    object(snapshot, 'History snapshot');
    const date = requiredText(snapshot.date, 'Snapshot date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) fail('Snapshot date must use YYYY-MM-DD.');
    if (seenDates.has(date)) fail('History contains a duplicate date.');
    seenDates.add(date);
    return {
      date,
      value: number(snapshot.value, 'Snapshot value', { maximum: Number.MAX_SAFE_INTEGER }),
      cost: number(snapshot.cost, 'Snapshot cost', { maximum: Number.MAX_SAFE_INTEGER }),
      quantity: number(snapshot.quantity, 'Snapshot quantity', { integer: true, maximum: Number.MAX_SAFE_INTEGER }),
      pricedQuantity: number(snapshot.pricedQuantity, 'Snapshot priced quantity', { integer: true, maximum: snapshot.quantity }),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { version: 1, collection, wishlist, binders, history };
}

/** Merge matching card/language/condition/binder rows, preserving total purchase cost. */
export function addCard(state, card, details = {}) {
  const metadata = cardMetadata(card);
  const fields = entryDetails(details, state.binders);
  const index = state.collection.findIndex(entry => entry.id === metadata.id && entry.lang === metadata.lang && entry.condition === fields.condition && entry.binderId === fields.binderId);
  let collection;
  if (index >= 0) {
    const previous = state.collection[index];
    const quantity = previous.quantity + fields.quantity;
    number(quantity, 'Combined quantity', { integer: true, minimum: 1, maximum: MAX_QUANTITY });
    const merged = { ...previous, ...metadata, ...fields, quantity, cost: (previous.cost * previous.quantity + fields.cost * fields.quantity) / quantity };
    // An unavailable refresh must not replace the last known reference price.
    if (metadata.price === null && previous.price !== null) {
      merged.price = previous.price;
      merged.priceUpdated = previous.priceUpdated;
    }
    collection = state.collection.map((entry, position) => position === index ? merged : entry);
  } else {
    if (state.collection.length >= MAX_ROWS) fail('The collection is too large to import safely in this browser.');
    collection = [...state.collection, { ...metadata, uid: uniqueId(), ...fields, addedAt: timestamp(details.addedAt, 'Date added') }];
  }
  return { ...state, collection };
}

/** Update an entry's editable fields. Price metadata may also be refreshed here. */
export function updateEntry(state, uid, details = {}) {
  const existing = state.collection.find(entry => entry.uid === uid);
  if (!existing) fail('This collection entry no longer exists.');
  const next = { ...existing, ...details };
  const entry = { ...cardMetadata(next), ...entryDetails(next, state.binders), uid: existing.uid, addedAt: existing.addedAt };
  return { ...state, collection: state.collection.map(item => item.uid === uid ? entry : item) };
}

export function removeEntry(state, uid) {
  return { ...state, collection: state.collection.filter(entry => entry.uid !== uid) };
}

/** value and profit cover priced entries only; cost covers the whole collection. */
export function totals(state) {
  const result = { quantity: 0, unique: 0, value: 0, cost: 0, profit: 0, pricedQuantity: 0, unpricedQuantity: 0, sets: 0 };
  const unique = new Set();
  const sets = new Set();
  for (const entry of state.collection) {
    result.quantity += entry.quantity;
    result.cost += entry.cost * entry.quantity;
    unique.add(`${entry.lang}:${entry.id}`);
    if (entry.setId) sets.add(entry.setId);
    if (typeof entry.price === 'number' && Number.isFinite(entry.price)) {
      result.value += entry.price * entry.quantity;
      result.profit += (entry.price - entry.cost) * entry.quantity;
      result.pricedQuantity += entry.quantity;
    } else result.unpricedQuantity += entry.quantity;
  }
  result.unique = unique.size;
  result.sets = sets.size;
  return result;
}

/** Store one real snapshot per local calendar day; never manufacture past history. */
export function recordSnapshot(state) {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const { value, cost, quantity, pricedQuantity } = totals(state);
  const snapshot = { date, value, cost, quantity, pricedQuantity };
  return { ...state, history: [...state.history.filter(point => point.date !== date), snapshot].sort((a, b) => a.date.localeCompare(b.date)) };
}

function csvText(value) {
  let valueText = String(value ?? '');
  // Prefix dangerous spreadsheet formulas, and escape literal leading apostrophes reversibly.
  if (/^[\s]*[=+\-@]/.test(valueText) || /^[\t\r\n']/.test(valueText)) valueText = `'${valueText}`;
  return `"${valueText.replaceAll('"', '""')}"`;
}
function decodeCSVText(value) {
  return value.startsWith("'") && (/^'[\s]*[=+\-@]/.test(value) || /^'[\t\r\n']/.test(value)) ? value.slice(1) : value;
}

/** Export collection rows only. Use JSON for a complete backup including wishlist/history. */
export function exportCSV(state) {
  const rows = state.collection.map(entry => {
    const row = { ...entry, binderName: state.binders.find(binder => binder.id === entry.binderId)?.name ?? 'My collection' };
    return CSV_COLUMNS.map(column => csvText(row[column])).join(',');
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

function parseCSV(source) {
  if (typeof source !== 'string' || source.length > 20 * 1024 * 1024) fail('Choose a CSV file smaller than 20 MB.');
  const input = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closedQuote = false;
  function finishField() { row.push(field); field = ''; closedQuote = false; }
  function finishRow() {
    finishField();
    if (row.some(cell => cell !== '')) rows.push(row);
    if (rows.length > MAX_ROWS + 1) fail('The CSV contains too many rows.');
    row = [];
  }
  for (let i = 0; i < input.length; i++) {
    const character = input[i];
    if (quoted) {
      if (character === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += character;
    } else if (character === ',') finishField();
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[i + 1] === '\n') i++;
      finishRow();
    } else if (character === '"' && !field && !closedQuote) quoted = true;
    else {
      if (closedQuote || character === '"') fail('Malformed CSV: unexpected text around a quoted field.');
      field += character;
    }
  }
  if (quoted) fail('Malformed CSV: a quoted field was not closed.');
  if (field || row.length || closedQuote) finishRow();
  return rows;
}

/** Append CSV rows atomically. Invalid rows reject the entire import; existing state is untouched. */
export function importCSV(source, state = emptyState()) {
  const rows = parseCSV(source);
  if (!rows.length) fail('This CSV file is empty.');
  const headers = rows.shift().map(header => header.trim());
  if (new Set(headers).size !== headers.length) fail('CSV column names must be unique.');
  for (const column of ['id', 'name', 'quantity', 'cost']) if (!headers.includes(column)) fail(`CSV is missing the ${column} column. Export a collection to see the supported format.`);
  let result = state;
  for (const [index, values] of rows.entries()) {
    if (values.length !== headers.length) fail(`CSV row ${index + 2} has a different number of columns from the header.`);
    const raw = Object.fromEntries(headers.map((header, column) => [header, decodeCSVText(values[column])]));
    const readNumber = (field, fallback) => {
      if (raw[field] === undefined || raw[field] === '') {
        if (fallback !== undefined) return fallback;
        fail(`CSV row ${index + 2}: ${field} is required.`);
      }
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?$/i.test(raw[field].trim())) fail(`CSV row ${index + 2}: ${field} must be numeric.`);
      return Number(raw[field]);
    };
    const card = {
      ...raw,
      lang: raw.lang || 'en',
      setTotal: readNumber('setTotal', 0),
      price: readNumber('price', null),
    };
    const binderId = raw.binderId || 'main';
    if (!result.binders.some(binder => binder.id === binderId)) {
      requiredText(binderId, 'Binder ID');
      result = { ...result, binders: [...result.binders, { id: binderId, name: requiredText(raw.binderName || binderId, 'Binder name', 100) }] };
    }
    try {
      result = addCard(result, card, {
        quantity: readNumber('quantity'), cost: readNumber('cost'), condition: raw.condition || 'Near Mint', binderId, addedAt: raw.addedAt || undefined,
      });
    } catch (error) { fail(`CSV row ${index + 2}: ${error.message}`); }
  }
  return result;
}
