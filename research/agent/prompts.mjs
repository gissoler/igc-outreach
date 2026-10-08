/**
 * Carga, verifica y renderiza prompts versionados.
 * No llama modelos ni decide variables de dominio.
 * Contratos: manifest de prompts y schemas asociados.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PromptIntegrityError } from './errors.mjs';

const defaultRoot = fileURLToPath(new URL('../../prompts/', import.meta.url));
const sha = s => createHash('sha256').update(s).digest('hex');

/**
 * Conserva el contrato público de loadPrompt para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function loadPrompt(id, version, { root = defaultRoot } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  const entry = manifest.prompts.find(p => p.id === id && p.version === version);
  if (!entry) throw new Error(`Unknown prompt ${id}@${version}`);
  const files = [...entry.files].sort();
  const contents = new Map(files.map(f => [f, readFileSync(resolve(root, f), 'utf8')]));
  const actual = sha(files.map(f => `${f}\n${contents.get(f)}\n`).join(''));
  if (actual !== entry.sha256) throw new PromptIntegrityError(id, version, entry.sha256, actual);
  const base = { id, version, sha256: entry.sha256 };
  if (id === 'b0_templates') return { ...base, templates: JSON.parse(contents.get(files[0])) };
  return { ...base, system: contents.get(`${id}/${version}/system.md`), user: contents.get(`${id}/${version}/user.md`) };
}

/**
 * Conserva el contrato público de render para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function render(template, vars) {
  const used = new Set();
  const result = template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`Missing prompt variable ${name}`);
    used.add(name);
    const v = vars[name];
    return typeof v === 'string' ? v : JSON.stringify(v, null, 1);
  });
  const extra = Object.keys(vars).filter(k => !used.has(k));
  if (extra.length) throw new Error(`Unused prompt variables: ${extra.join(', ')}`);
  if (result.includes('{{')) throw new Error('Unresolved or nested prompt placeholder');
  return result;
}

/**
 * Conserva el contrato público de sanitizePageText para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function sanitizePageText(s) {
  return String(s ?? '').replaceAll('<page_data>', '').replaceAll('</page_data>', '').replace(/\s+/g, ' ').trim();
}
