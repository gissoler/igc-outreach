// R4 (reunión con David Castro, 09/10): preguntar al usuario ANTES de enriquecer la intención cuando hay poco tras 2 rondas.
// SOLO DISEÑO + PRUEBA SIMULADA. Apagado por defecto (enabled=false) y NO está conectado a run-experiment ni al motor:
// en el benchmark no hay usuario, así que nunca se pregunta. No cambia B1/B2/B2E.
//
// Cuándo pregunta: en el mismo punto donde se calcula sparse_after_round_2 (al empezar la 3.ª llamada del planner),
//   si enabled=true, hay un canal con el usuario (ask) y quedan menos de `threshold` firmas aceptadas (por defecto 3, igual que sparse).
//   Como mucho una vez por corrida.
// Qué pregunta: el LLM (propose) devuelve hasta 2 reformulaciones de description/product (otro énfasis o vocabulario; los
//   campos estructurados no cambian). Se muestra: «Encontré N firmas tras 2 rondas. ¿También buscas…? (a) … (b) … Responde a, b, ambas o no».
// Cómo se reanuda: «a»/«b»/«ambas» → nuevo perfil (la reformulación elegida se añade a description; product se reemplaza solo con una
//   única opción) y el motor sigue en la ronda 3 con las consultas ya vistas y las firmas ya aceptadas; «no», vacío o sin respuesta
//   (timeout) → se para y se responde «encontré poco» con lo que hay (stop_reason 'sparse_user_declined').
export const INTENT_CLARIFY_DEFAULTS = Object.freeze({ enabled: false, threshold: 3, max_options: 2, timeout_ms: 120_000 });

export function buildQuestion(acceptedCount, options) {
  const letters = ['a', 'b'];
  return [`Encontré ${acceptedCount} firma${acceptedCount === 1 ? '' : 's'} tras 2 rondas. ¿También buscas esto?`,
    ...options.map((o, i) => `(${letters[i]}) ${o.product}`), 'Responde a, b, ambas o no.'].join('\n');
}

export function parseAnswer(text, nOptions) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t || /^(no|n|ninguna)$/.test(t)) return [];
  if (/^(ambas|las dos|both|si|sí)$/.test(t)) return [...Array(nOptions).keys()];
  return [...new Set((t.match(/\b[ab]\b/g) ?? []).map(x => x.charCodeAt(0) - 97).filter(i => i < nOptions))];
}

export function applyChoice(profile, options, chosen) {
  const p = structuredClone(profile), f = p.fields, picked = chosen.map(i => options[i]);
  f.description = { ...f.description, value: [f.description.value, ...picked.map(o => o.description)].join(' ') };
  if (picked.length === 1) f.product = { ...f.product, value: picked[0].product };
  p.provenance = { ...p.provenance, intent_clarified: { chosen, at_round: 3 } };
  return p;
}

// ask(question) → Promise<string|null>; propose({ profile, accepted }) → Promise<[{product, description}]>.
export function createIntentClarifier({ enabled = INTENT_CLARIFY_DEFAULTS.enabled, threshold = INTENT_CLARIFY_DEFAULTS.threshold, maxOptions = INTENT_CLARIFY_DEFAULTS.max_options, timeoutMs = INTENT_CLARIFY_DEFAULTS.timeout_ms, ask = null, propose = null, log = () => {} } = {}) {
  let used = false;
  return {
    async atRound3Start({ profile, acceptedCount }) {
      if (!enabled || !ask || !propose || used || acceptedCount >= threshold) return { action: 'continue', profile };
      used = true;
      const options = (await propose({ profile, accepted: acceptedCount })).slice(0, maxOptions);
      if (!options.length) return { action: 'continue', profile };
      const question = buildQuestion(acceptedCount, options);
      let timer; const answer = await Promise.race([ask(question), new Promise(r => { timer = setTimeout(() => r(null), timeoutMs); })]).finally(() => clearTimeout(timer));
      const chosen = parseAnswer(answer, options.length);
      log({ event: 'intent_clarification', accepted_after_round_2: acceptedCount, question, answer, chosen });
      if (!chosen.length) return { action: 'stop', stop_reason: 'sparse_user_declined', message: `Encontré poco: ${acceptedCount} firma(s) tras 2 rondas.`, profile };
      return { action: 'resume', profile: applyChoice(profile, options, chosen) };
    }
  };
}
