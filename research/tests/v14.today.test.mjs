import test from 'node:test';
import assert from 'node:assert/strict';
import { openAlexFunders, edgarPeers } from '../server/research/lateral.mjs';

test('F2.0 today string fija el año de OpenAlex', async () => {
  let requested = '';
  const fetcher = async (url) => { requested = String(url); return { ok: true, json: async () => ({ group_by: [] }) }; };
  await openAlexFunders({ industry: 'Alzheimer data' }, { today: '2026-10-12', fetcher });
  assert.match(requested, /publication_year:>2023/);
});

test('F2.0 today string fija el inicio de EDGAR', async () => {
  let requested = '';
  const fetcher = async (url) => { requested = String(url); return { ok: true, json: async () => ({ hits: { hits: [] } }) }; };
  await edgarPeers({ industry: 'biotech' }, { today: '2026-10-12', env: { SEC_USER_AGENT: 'IGC research contact@example.org' }, fetcher });
  assert.match(requested, /startdt=2025-10-12/);
});
