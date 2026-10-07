import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const root = resolve(repo, 'docs/contracts');
const investorRoot = resolve(root, 'investor');
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
addFormats(ajv);
ajv.addSchema(JSON.parse(readFileSync(resolve(root, 'common.schema.json'), 'utf8')));
const schemas = new Map();
for (const file of readdirSync(investorRoot).filter(x => x.endsWith('.schema.json')).sort()) {
  const schema = JSON.parse(readFileSync(resolve(investorRoot, file), 'utf8')); schemas.set(file.replace('.schema.json', ''), schema);
  ajv.addSchema(schema);
}

export class InvestorContractError extends Error {
  constructor(name, errors) {
    super(`${name} contract failed: ${errors.map(x => `${x.instancePath || '/'} ${x.message}`).join('; ')}`);
    this.name = 'InvestorContractError';
    this.code = 'CONTRACT';
    this.errors = errors;
  }
}

export function validateInvestor(name, value) {
  const id = `https://outreach.local/contracts/investor/${name}.schema.json`;
  const fn = ajv.getSchema(id);
  if (!fn) throw new InvestorContractError(name, [{ instancePath: '/', message: 'unknown contract' }]);
  if (!fn(value)) throw new InvestorContractError(name, structuredClone(fn.errors ?? []));
  return value;
}

export function loadInvestorJson(path) {
  return JSON.parse(readFileSync(resolve(repo, path), 'utf8'));
}

function pointer(rootValue, fragment) { return fragment.split('/').slice(1).reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], rootValue); }
export function bundleInvestor(name) {
  const start = schemas.get(name); if (!start) throw new InvestorContractError(name, [{ instancePath: '/', message: 'unknown contract' }]);
  const expand = (value, current, stack) => {
    if (Array.isArray(value)) return value.map(x => expand(x, current, stack)); if (!value || typeof value !== 'object') return value;
    if (value.$ref) { const [filePart, fragment = ''] = value.$ref.split('#'), targetName = filePart ? filePart.replace('.schema.json', '') : current, targetSchema = targetName === '../common' ? JSON.parse(readFileSync(resolve(root, 'common.schema.json'), 'utf8')) : schemas.get(targetName), target = fragment ? pointer(targetSchema, fragment) : targetSchema, key = `${targetName}#${fragment}`; if (!target || stack.has(key)) throw new Error(`Cannot bundle ${value.$ref}`); return expand(target, targetName, new Set([...stack, key])); }
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['$id','$schema'].includes(key)).map(([key, child]) => [key, expand(child, current, stack)]));
  };
  return expand(start, name, new Set([`${name}#`]));
}

export { repo as investorRepoRoot };
