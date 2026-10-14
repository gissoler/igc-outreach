import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStep } from '../server/research/agentic/contracts.v14.mjs';

const action = (tool, args = {}) => ({ thought: 'next', assessment: null, notes: [], action: { tool, args, from_lead: null } });
const assessed = () => ({ ...action('open', { ref: 'p1.l2' }), assessment: { ref: 'p1', page_type: 'call', about: 'Program', dates: [], date_missing_next: null, criteria: { official: { verdict: 'yes', quote: 'Official program', reason: 'Published by the program.' } }, candidate: true, lead: null } });

for (const [name, value, context] of [
  ['search válido', action('search', { query: 'Alzheimer grants' }), {}],
  ['página evaluada válida', assessed(), { lastObservation: 'page' }],
  ['finish válido', action('finish', { reason: 'enough', finalists: ['p1'] }), {}],
]) test(`F2.2 ${name}`, () => assert.equal(validateStep(value, context).ok, true));

for (const [name, value, context] of [
  ['sin action', { thought: 'x', assessment: null, notes: [] }, {}],
  ['tool desconocida', action('browse', {}), {}],
  ['assessment ausente tras página', action('open', { ref: 'p1.l2' }), { lastObservation: 'page' }],
  ['verdict fuera de enum', { ...assessed(), assessment: { ...assessed().assessment, criteria: { official: { verdict: 'maybe', quote: null, reason: 'x' } } } }, { lastObservation: 'page' }],
  ['más de tres preguntas', action('ask_user', { questions: [{ q: '1' }, { q: '2' }, { q: '3' }, { q: '4' }] }), {}],
]) test(`F2.2 rechaza ${name}`, () => assert.equal(validateStep(value, context).ok, false));
