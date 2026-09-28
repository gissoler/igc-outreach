// Uso (desde tu Mac, con acceso a la flota): node --env-file-if-exists=.env scripts/fleet-check.mjs
// Imprime los ids reales de cada puerto y las líneas sugeridas para .env.
import { listModels } from '../server/analysis/fleet.mjs';
const env = { VLLM_BASE: 'http://147.185.41.229', ...process.env };
const models = await listModels(env);
const keys = { chat: 'VLLM_CHAT_MODEL', small: 'VLLM_SMALL_MODEL', reasoning: 'VLLM_REASONING_MODEL', embed: 'VLLM_EMBED_MODEL', rerank: 'VLLM_RERANK_MODEL' };
for (const [role, info] of Object.entries(models)) console.log(`${role.padEnd(9)} ${info.url || ''} → ${info.error ? `ERROR: ${info.error}` : info.ids.join(', ')}`);
console.log('\n# Pega en research/.env:');
console.log(`VLLM_BASE=${env.VLLM_BASE}`);
for (const [role, info] of Object.entries(models)) if (info.ids?.length) console.log(`${keys[role]}=${info.ids[0]}`);
