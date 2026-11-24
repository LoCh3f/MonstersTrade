import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../dist/${file}`, import.meta.url), 'utf8');
const source = await read('_headers');
const headers = Object.fromEntries(source.split('\n').filter(line => /^\s+\S+:/.test(line)).map(line => {
  const colon = line.indexOf(':'); return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()];
}));
const policy = new Map(headers['content-security-policy'].split(';').map(part => {
  const [name, ...values] = part.trim().split(/\s+/); return [name, values];
}));

test('static responses deny framing, inline scripts and unused browser capabilities', () => {
  assert.match(source, /^\/\*$/m);
  for (const directive of ['default-src', 'script-src-attr', 'base-uri', 'form-action', 'frame-ancestors', 'object-src']) {
    assert.deepEqual(policy.get(directive), ["'none'"]);
  }
  assert.deepEqual(policy.get('script-src'), ["'self'"]);
  assert.deepEqual(policy.get('worker-src'), ["'self'"]);
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) assert.ok(headers['permissions-policy'].includes(`${feature}=()`));
});

test('policy allows existing fonts, catalogue requests, local workers and custom HTTPS photos', async () => {
  const styles = await read('styles.css');
  const stylesheetURL = /@import url\('([^']+)'\)/.exec(styles)[1];
  assert.ok(policy.get('style-src').includes(new URL(stylesheetURL).origin));
  assert.deepEqual(policy.get('font-src'), ['https://fonts.gstatic.com']);
  assert.deepEqual(policy.get('style-src-attr'), ["'unsafe-inline'"]);
  const catalogue = await read('catalog.js');
  const api = /const API = '([^']+)'/.exec(catalogue)[1];
  assert.ok(policy.get('connect-src').includes(new URL(api).origin));
  assert.ok(policy.get('connect-src').includes("'self'"));
  assert.deepEqual(policy.get('img-src'), ["'self'", 'https:']);
});
