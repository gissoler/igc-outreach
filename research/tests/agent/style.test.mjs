/**
 * Verifica el formato mecánico exigido al núcleo y al harness.
 * No interpreta semántica ni modifica archivos.
 * Contrato: REFACTOR-PLAN ACC-75 y su estándar de comentarios.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const researchRoot = resolve(import.meta.dirname, '../..');
const agentRoot = resolve(researchRoot, 'agent');
const benchRoot = resolve(researchRoot, 'bench');

function moduleFiles(dir, recursive) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!recursive || entry.name === 'config') return [];
      return moduleFiles(path, true);
    }
    return entry.name.endsWith('.mjs') ? [path] : [];
  });
}

function hasRegexLiteral(line) {
  return /\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\n])+\/[dgimsuvy]*/.test(line);
}

function longLines(path) {
  let dataArrayDepth = 0;
  return readFileSync(path, 'utf8').split('\n').flatMap((line, index) => {
    if (line.includes('// datos')) dataArrayDepth = 1;
    else if (dataArrayDepth) {
      for (const char of line) {
        if (char === '[') dataArrayDepth++;
        if (char === ']') dataArrayDepth--;
      }
    }
    if (line.length <= 140 || hasRegexLiteral(line) || dataArrayDepth) return [];
    return [`${path}:${index + 1} (${line.length})`];
  });
}

function exportedFunctionsWithoutContract(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const missing = [];
  const declaration = /^\s*export (?:async )?function\s+\w+\s*\(([^)]*)\)|^\s*export const \w+ = \(([^)]*)\)/;
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(declaration);
    if (!match) continue;
    let cursor = index - 1;
    while (cursor >= 0 && !lines[cursor].trim()) cursor--;
    if (cursor < 0 || !lines[cursor].trim().endsWith('*/')) {
      missing.push(`${path}:${index + 1} sin docblock`);
      continue;
    }
    const end = cursor;
    while (cursor >= 0 && !lines[cursor].includes('/**')) cursor--;
    const block = cursor >= 0 ? lines.slice(cursor, end + 1).join('\n') : '';
    const params = (match[1] ?? match[2] ?? '').trim();
    if (!block.includes('@returns') || (params && !block.includes('@param'))) {
      missing.push(`${path}:${index + 1} contrato incompleto`);
    }
  }
  return missing;
}

const files = [
  ...moduleFiles(agentRoot, true),
  ...moduleFiles(benchRoot, false),
].sort();

test('ACC-75a limits source lines to 140 columns', () => {
  assert.deepEqual(files.flatMap(longLines), []);
});

test('ACC-75b exported functions document parameters and returns', () => {
  assert.deepEqual(files.flatMap(exportedFunctionsWithoutContract), []);
});

test('ACC-75c every module starts with its responsibility contract', () => {
  const missing = files.filter(path => {
    const source = readFileSync(path, 'utf8').replace(/^#![^\n]*\n/, '');
    return !source.startsWith('/**');
  });
  assert.deepEqual(missing, []);
});

test('ACC-75d the core has no dynamic imports', () => {
  const dynamic = moduleFiles(agentRoot, true).filter(path => readFileSync(path, 'utf8').includes('await import('));
  assert.deepEqual(dynamic, []);
});
