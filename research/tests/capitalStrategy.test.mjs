import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapitalStrategyContext, attachCapitalEvidence } from '../capital/strategy.mjs';
import { validateCapital } from '../capital/contracts.mjs';
import { selectCapitalTool } from '../capital/tools.mjs';

const brief = { company: 'Synthetic Health Co', product: 'A triage support tool', description: 'Helps clinics prioritize referrals', industry: 'rural health', stage: 'pilot', geography: 'Colombia', fundingTypes: ['investment', 'grant'], entityType: 'for_profit' };

test('capital strategy contract preserves the declared segment and produces 3-6 hypothesis routes', async () => {
  const result = await buildCapitalStrategyContext(brief, { asOf: '2026-10-08', plan: null, available: { searxng: true } });
  assert.equal(result.schema_version, 'capital_strategy_context/1');
  assert.equal(result.declared_segment.name, 'rural health');
  assert.equal(result.declared_segment.confirmed, true);
  assert.ok(result.proposed_routes.length >= 3 && result.proposed_routes.length <= 6);
  assert.equal(result.proposed_routes[0].status, 'hypothesis');
  assert.deepEqual(result.proposed_routes[0].comparables, []);
  assert.equal(validateCapital('capital_strategy_context', result), result);
});

test('tool selection follows the question rather than a sector switch', () => {
  assert.equal(selectCapitalTool('Who funded the documented Series A round?').tool, 'funding_round_sources');
  assert.equal(selectCapitalTool('Which partner works at the selected firm?').tool, 'apollo');
  assert.equal(selectCapitalTool('Is there a verified path in my network?').tool, 'authorized_network');
  assert.equal(selectCapitalTool('Verify this official page and capture a quote.').tool, 'page_reader');
});

test('only verified findings promote a route from hypothesis to evidence_backed', async () => {
  const context = await buildCapitalStrategyContext(brief, { asOf: '2026-10-08' });
  const route = context.proposed_routes[0];
  const query = route.queries[0].query;
  const updated = attachCapitalEvidence(context, [{ query, url: 'https://example.org/official', name: 'Synthetic Comparable', quotes: { identity: 'Synthetic Comparable received a documented pilot award.' } }], '2026-10-08');
  assert.equal(updated.proposed_routes[0].status, 'evidence_backed');
  assert.equal(updated.proposed_routes[0].evidence[0].quote, 'Synthetic Comparable received a documented pilot award.');
});
