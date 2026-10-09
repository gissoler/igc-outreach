import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { preflightApollo } from '../capital/apollo.mjs';

const args = process.argv.slice(2);
const value = (name, fallback = '') => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || fallback : fallback; };
const asOf = value('--as-of', new Date().toISOString().slice(0, 10));
const domain = value('--domain', process.env.APOLLO_PREFLIGHT_DOMAIN || 'apollo.io');
const out = value('--out');
const result = await preflightApollo({
  apiKey: process.env.APOLLO_API_KEY,
  domain,
  asOf,
  clientOptions: { timeoutMs: Number(process.env.APOLLO_TIMEOUT_MS) || 15000 },
});
const json = `${JSON.stringify(result, null, 2)}\n`;
if (out) { const target = resolve(out); await mkdir(dirname(target), { recursive: true }); await writeFile(target, json, { mode: 0o600 }); }
process.stdout.write(json);
if (['authentication_failed', 'insufficient_credits', 'unsupported_by_plan', 'error'].includes(result.status)) process.exitCode = 2;
