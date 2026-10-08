import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const productionVariables = `
ADVISOR_AUTO ADVISOR_MODEL ADVISOR_ROLE ENGINE_DATE_REREAD_MAX ENGINE_EXPAND_ROLE ENGINE_EXPAND_SIMILAR
ENGINE_LLM_THINKING ENGINE_QUERY_YEAR ENGINE_RESEARCH_CANDIDATES ENGINE_TBS ENGINE_TRACE_MAX ENGINE_TRACE_SKIPPED_MAX
EXA_TEXT_CHARS FIRECRAWL_CACHE FIRECRAWL_RATE_BACKOFF_MS FIRECRAWL_SCRAPE_TIMEOUT_MS FIRECRAWL_SEARCH_TIMEOUT_MS
GRANT_API_QUERIES GRANT_PAGE_MODEL GRANT_WEB_CREDITS GRANT_WEB_MODEL_QUERIES HUNTER_TIMEOUT_MS INTAKE_LLM_MAX_TOKENS
INTAKE_LLM_REASONING_EFFORT INTAKE_LLM_ROLE JINA_SEARCH_CONTENT JINA_TIMEOUT_MS LINKUP_TIMEOUT_MS ORCHESTRATOR_JEV_TIMEOUT_MS
ORCHESTRATOR_MIN_REMAINING_MS PAGE_READER_ORDER PLAYWRIGHT_CHROMIUM_EXECUTABLE QUERY_EXPAND_EXA_MAX QUERY_EXPAND_LLM
QUERY_EXPAND_MAX QUERY_EXPAND_TIMEOUT_MS REGISTRY_VERIFY RESEARCH_BROWSER RESEARCH_BROWSER_JPEG_QUALITY RESEARCH_BROWSER_TIMEOUT_MS
RESEARCH_PUBLIC_ORIGIN SCRAPEGRAPH_API_KEY SEARCH_COMPLEMENT SEARCH_PROVIDER SEARXNG_TIMEOUT_MS SERPER_TIMEOUT_MS TYPESAFE_API_KEY
WEB_LINKEDIN_MAX_PAGES WEB_TIMEOUT_MS YOU_API_URL
`.trim().split(/\s+/);

const benchmarkVariables = [
  'PREANNOTATOR_BASE_URL',
  'PREANNOTATOR_MODEL',
  'PREANNOTATOR_API_KEY',
];

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('ACC-74: .env.example documenta L1 y L2 sin valores secretos', () => {
  const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');

  for (const name of [...productionVariables, ...benchmarkVariables]) {
    assert.match(example, new RegExp(`^#\\s+${escapeRegex(name)}=$`, 'm'), `${name} debe aparecer comentada y sin valor`);
  }

  assert.match(example, /^# --- Producción \(no documentadas hasta 07\/10\/2026\) ---$/m);
  assert.match(example, /^# --- Benchmark: preanotador \(nombres que fija run_config\.preannotator_model\) ---$/m);

  for (const line of example.split('\n')) {
    const match = line.match(/^#?\s*([A-Z][A-Z0-9_]*(?:KEY|TOKEN))=(.*)$/);
    if (match) {
      const value = match[2].replace(/\s+#.*$/, '').trim();
      assert.equal(value, '', `${match[1]} no puede contener un valor`);
    }
  }
});
