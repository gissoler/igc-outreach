// V7: dependencias en vivo = las de external.mjs (que no se edita) con el extractor v7 (C2). Misma llamada al LLM, misma
// clave de caché (prompt + texto + semilla 0): la página que ya se extrajo en v5 no se vuelve a pedir al modelo.
import { render, sanitizePageText } from '../../agent/prompts.mjs';
import { createLiveInvestorDeps } from './external.mjs';
import { describeInvestorExtraction } from './extractor.mjs';
import { extractFixtureInvestorV7 } from './extractor.v7.mjs';

export function createLiveInvestorDepsV7({ search, fetch, llm, plannerPrompt, extractorPrompt, judgePrompt = null, config, seed }) {
  const base = createLiveInvestorDeps({ search, fetch, llm, plannerPrompt, extractorPrompt, judgePrompt, config, seed });
  if (config.extractor_impl !== 'v7') return base;
  return {
    ...base,
    async extract({ document, today, firstSeen }) {
      const safePageText = sanitizePageText(document.text).replaceAll('{{', '{ {').replaceAll('}}', '} }').slice(0, 24000);
      const user = render(extractorPrompt.user, { today, url: document.url, page_text: safePageText });
      const schemaName = config.extraction_schema;
      let result;
      try { result = await llm.call({ prompt: extractorPrompt, user, schemaName, temperature: 0, seed: 0, maxTokens: config.extractor_max_tokens ?? 8000 }); }
      catch (error) { return { entity: null, rejected_kind: 'llm_invalid_output', candidates: [], diagnostics: { kind: null, error: String(error.message).slice(0, 200) }, tokens_nominal: 0, latency: null }; }
      const extracted = extractFixtureInvestorV7({ document, extraction: result.json, today, firstSeen });
      const d = describeInvestorExtraction({ document, raw: result.json, grounded: null, entity: extracted.entity });
      const diagnostics = { ...d, quote_source: extracted.meta.quote_source, quote_check: extracted.meta.quote_check, official_domain_source: extracted.meta.official_domain_source, fields_dropped_by_grounding: extracted.meta.fields_dropped_by_grounding, candidates: extracted.candidates?.length ?? 0, candidates_raw: Array.isArray(result.json?.candidates) ? result.json.candidates.length : 0 };
      return { ...extracted, diagnostics, tokens_nominal: result.tokens_nominal, latency: result.latency };
    }
  };
}
