/* El Run audit genera un prompt listo para pegar en otra IA, con el mismo brief y las mismas reglas que la corrida. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRunAudit, comparisonPrompt } from '../server/research/runAudit.mjs';

const mentiva = JSON.parse(readFileSync(new URL('../eval/briefs/mentiva.json', import.meta.url), 'utf8'));
const aha = { company: 'AHA', venture: 'AHA', oneLiner: "AI-powered data harmonization for Alzheimer's research", industry: 'Healthcare Neuroscience Research Infrastructure', stage: 'prototype', round: 'pre-seed', geography: 'GLOBAL', amount: 200000, minDays: 30, constraints: 'No equity dilution; No commercial monetization', fundingTypes: ['grant'] };

test('prompt de grants: fecha de hoy, límite con los días mínimos, reglas del verificador y supuesto de entidad declarado', () => {
  const p = comparisonPrompt(aha, '2026-10-01', 'grant');
  assert.match(p, /Hoy es 2026-10-01/); assert.match(p, /posterior al 2026-10-31 \(mínimo 30 días/); assert.match(p, /200,000 USD/);
  assert.match(p, /NO está definido en el brief \(el motor asumió: empresa \/ startup con fines de lucro\)/, 'no esconde que el tipo de entidad es un supuesto');
  assert.match(p, /CITA LITERAL/); assert.match(p, /agregadores/); assert.match(p, /No inventes nada/);
});

test('prompt de grants con entidad conocida: usa la del brief y el país de constitución', () => {
  const p = comparisonPrompt(mentiva, '2026-10-01', 'grant');
  assert.match(p, /constituida FUERA de: US, EU/); assert.ok(!/NO está definido/.test(p) || /asumió/.test(p));
  const np = comparisonPrompt({ ...aha, entityType: 'nonprofit' }, '2026-10-01', 'grant');
  assert.match(np, /Tipo de entidad: organización sin ánimo de lucro/); assert.ok(!/asumió/.test(np));
});

test('prompt de inversores: firmas oficiales, cargo solo si la página lo dice, sin ventas ni marketing', () => {
  const p = comparisonPrompt({ ...mentiva, fundingTypes: ['investment'] }, '2026-10-01', 'investment');
  assert.match(p, /INVERSORES/); assert.match(p, /ventas, marketing/); assert.match(p, /solo si la página oficial la nombra con su cargo/); assert.ok(!/fecha límite/i.test(p));
});

test('runAudit incluye un prompt por tipo (grant e investment) y ninguno si no hay brief de esos tipos', () => {
  const a = buildRunAudit({ brief: { ...mentiva, fundingTypes: ['grant', 'investment', 'debt'] }, today: '2026-10-01' });
  assert.deepEqual(Object.keys(a.comparePrompts).sort(), ['grant', 'investment']);
  assert.deepEqual(buildRunAudit({ today: '2026-10-01' }).comparePrompts, {});
});
