/* ─────────────────────────────────────────────────────────────────────────────
   Qué fuentes de búsqueda WEB corren en una investigación. Regla única: si el motor (runEngine) está disponible,
   es el único camino de búsqueda web para TODOS los objetivos (grants, inversión, deuda, patrocinio, alianzas):
   solo cambian las consultas y el verificador por objetivo. Las fuentes web antiguas (Exa directo, rondas,
   Serper, Apify y los lazos agénticos) solo corren de respaldo cuando el motor no está disponible, porque sus
   resultados no pasan por la verificación en código (fecha contra hoy con cita, elegibilidad contra el brief).
   Los registros estructurados (Grants.gov, NIH, OpenAlex, ClinicalTrials) no son búsqueda web y no dependen de esto.
   ───────────────────────────────────────────────────────────────────────────── */
import { searxngBase } from './searchApis.mjs';
export function webSourcePlan({ fundingTypes = [], engineOn = false, env = {}, providers = null } = {}) {
  const grantsOnly = fundingTypes.length === 1 && fundingTypes[0] === 'grant';
  // Con motor, o con proveedores inyectados (pruebas), o en grants solos, las fuentes web antiguas no corren.
  const legacy = !providers && !engineOn && !grantsOnly;
  return {
    grantsOnly, legacy,
    exa: legacy && !searxngBase(env) && Boolean(env.EXA_API_KEY),
    rounds: !engineOn && !searxngBase(env) && fundingTypes.includes('investment') && Boolean(env.EXA_API_KEY || env.SERPER_API_KEY),
    serper: legacy && !searxngBase(env) && Boolean(env.SERPER_API_KEY),
    agentic: legacy,
  };
}
