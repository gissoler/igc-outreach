/**
 * Carga y valida los contratos JSON usados por el agente.
 * No transforma datos ni corrige entradas inválidas.
 * Contratos: schemas v1 registrados en este módulo.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ContractError } from './errors.mjs';

const contractsUrl = new URL('../../docs/contracts/', import.meta.url);
const contractsDir = fileURLToPath(contractsUrl);
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
addFormats(ajv);
const schemas = new Map();
for (const file of readdirSync(contractsDir).filter(x => x.endsWith('.schema.json')).sort()) {
  const schema = JSON.parse(readFileSync(resolve(contractsDir, file), 'utf8'));
  schemas.set(file.replace('.schema.json', ''), schema);
  ajv.addSchema(schema);
}
const validators = new Map();

/**
 * Conserva el contrato público de validate para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function validate(name, obj) {
  let fn = validators.get(name);
  if (!fn) {
    const id = `https://outreach.local/contracts/${name}.schema.json`;
    fn = ajv.getSchema(id);
    if (!fn) throw new ContractError(name, [{ message: 'unknown contract' }]);
    validators.set(name, fn);
  }
  if (!fn(obj)) throw new ContractError(name, structuredClone(fn.errors || []));
  return obj;
}

function pointer(root, fragment) {
  return fragment.split('/').slice(1).reduce((v, k) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], root);
}

/**
 * Conserva el contrato público de bundle para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function bundle(name) {
  const start = schemas.get(name);
  if (!start) throw new ContractError(name, [{ message: 'unknown contract' }]);
  const expand = (value, current, stack) => {
    if (Array.isArray(value)) return value.map(v => expand(v, current, stack));
    if (!value || typeof value !== 'object') return value;
    if (value.$ref) {
      const [filePart, fragment = ''] = value.$ref.split('#');
      const targetName = filePart ? filePart.replace('.schema.json', '') : current;
      const targetSchema = schemas.get(targetName);
      const target = fragment ? pointer(targetSchema, fragment) : targetSchema;
      const key = `${targetName}#${fragment}`;
      if (!target || stack.has(key)) throw new Error(`Cannot bundle cyclic or missing ref ${value.$ref}`);
      return expand(target, targetName, new Set([...stack, key]));
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '$id' || k === '$schema') continue;
      out[k] = expand(v, current, stack);
    }
    return out;
  };
  return expand(start, name, new Set([`${name}#`]));
}
