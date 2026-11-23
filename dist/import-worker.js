import { normalizeState, importCSV, totals } from './model.js';

// Parsing and validation stay on this device, outside the UI thread. The caller
// can terminate this worker without changing the saved or in-memory collection.
self.addEventListener('message', event => {
  try {
    const { source, format, current } = event.data;
    if (typeof source !== 'string' || source.length > 20 * 1024 * 1024) throw new Error('Choose a file smaller than 20 MB.');
    if (!['json', 'csv'].includes(format)) throw new Error('Choose a .json or .csv file.');
    const state = format === 'json' ? normalizeState(JSON.parse(source)) : importCSV(source, current);
    self.postMessage({ state, quantity: totals(state).quantity });
  } catch (error) {
    self.postMessage({ error: error.message || 'This file could not be imported.' });
  }
});
