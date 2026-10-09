import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const files = {
  capital_strategy_context: 'capital_strategy_context.v1.schema.json',
  apollo_preflight: 'apollo_preflight.v1.schema.json',
  contact_bridge_result: 'contact_bridge_result.v1.schema.json',
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validators = Object.fromEntries(Object.entries(files).map(([name, file]) => {
  const schema = JSON.parse(readFileSync(join(here, 'schemas', file), 'utf8'));
  return [name, ajv.compile(schema)];
}));

export class CapitalContractError extends Error {
  constructor(name, errors) {
    super(`${name} contract failed: ${ajv.errorsText(errors, { separator: '; ' })}`);
    this.name = 'CapitalContractError';
    this.code = 'CAPITAL_CONTRACT_INVALID';
    this.contract = name;
    this.errors = errors;
  }
}

export function validateCapital(name, value) {
  const validator = validators[name];
  if (!validator) throw new CapitalContractError(name, [{ message: 'unknown contract' }]);
  if (!validator(value)) throw new CapitalContractError(name, validator.errors || []);
  return value;
}
