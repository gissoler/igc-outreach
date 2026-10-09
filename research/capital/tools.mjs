const TOOL_SET = new Set(['searxng', 'page_reader', 'official_grants', 'funding_round_sources', 'apollo', 'authorized_network', 'llm']);
const text = (value) => String(value || '').toLowerCase();

/** Selects by the question being answered, never by sector. */
export function selectCapitalTool(question, { available = {} } = {}) {
  const q = text(question);
  const candidates = [];
  if (/person|partner|principal|decision.?maker|contact|who works|cargo/.test(q)) candidates.push('apollo');
  if (/warm|intro|bridge|connection|network|present/.test(q)) candidates.push('authorized_network');
  if (/grant|challenge|prize|award|fellowship|open call|convocatoria/.test(q)) candidates.push('official_grants');
  if (/round|raised|financ|invested|investor|venture|funded by/.test(q)) candidates.push('funding_round_sources');
  if (/verify|evidence|official page|source|quote|terms|eligib/.test(q)) candidates.push('page_reader');
  if (/plan|segment|adjacent|comparable|hypothesis|strategy/.test(q)) candidates.push('llm');
  candidates.push('searxng');
  const tool = candidates.find((name) => available[name] !== false) || 'searxng';
  return {
    tool,
    reason: {
      apollo: 'Resolve an already identified organization or person; it does not establish fit or a warm relationship.',
      authorized_network: 'Only authorized network evidence can verify a network path.',
      official_grants: 'Use the official program or grant source for eligibility, dates and application facts.',
      funding_round_sources: 'Use documented rounds and official fund/company announcements to verify who funded a comparable.',
      page_reader: 'Open the primary page and capture dated, literal evidence before treating a claim as fact.',
      llm: 'Generate structured hypotheses and questions; evidence must come from tools and primary sources.',
      searxng: 'Discover candidate pages broadly, then verify promising results with a reader.',
    }[tool],
  };
}

export function normalizeRecommendedTools(values, question, options) {
  const proposed = (Array.isArray(values) ? values : []).filter((name) => TOOL_SET.has(name));
  const picked = selectCapitalTool(question, options).tool;
  return [...new Set([picked, ...proposed])].slice(0, 4);
}

export const CAPITAL_TOOLS = Object.freeze([...TOOL_SET]);
