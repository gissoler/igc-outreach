/**
 * Define los errores tipados del núcleo.
 * No captura errores ni decide su recuperación.
 * Contratos: códigos públicos de error del agente.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
export class ContractError extends Error {
  constructor(name, errors = []) {
    super(`Contract ${name} validation failed: ${JSON.stringify(errors)}`.slice(0, 300));
    this.name = 'ContractError';
    this.code = 'CONTRACT';
    this.contract = name;
    this.errors = errors;
  }
}

export class PromptIntegrityError extends Error {
  constructor(id, version, expected, actual) {
    super(`Prompt integrity failed for ${id}@${version}: expected ${expected}, got ${actual}`);
    this.name = 'PromptIntegrityError';
    this.code = 'CONTRACT';
    Object.assign(this, { id, version, expected, actual });
  }
}

export class LlmError extends Error {
  constructor(code, message) {
    super(String(message).slice(0, 300));
    this.name = 'LlmError';
    this.code = code;
  }
}
