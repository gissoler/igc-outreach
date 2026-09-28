import { candidate, evidence } from './core.mjs';
export function demoLeads(brief) {
  return [
    'Aurora',
    'Horizon',
    'Beacon',
    'Nexus',
    'Prisma',
    'Threshold',
    'Atlas',
  ].map((name, i) =>
    candidate({
      person: `Sample contact ${i + 1}`,
      role: 'Fictional demo role',
      org: `${name} — fictional organization`,
      title: `Sample ${i + 1}: ${brief.fundingTypes[0] === 'partnering' ? 'scientific collaboration' : 'funding program'}`,
      kind: i === 6 ? 'radar' : 'opportunity',
      fundingType: brief.fundingTypes[0],
      status: i === 6 ? 'closed' : 'open',
      deadline: null,
      amount: null,
      demo: true,
      searchText: brief.industry,
      evidence: [
        evidence(
          'Demo fixture',
          'https://example.org',
          `FICTIONAL EXAMPLE. Not evidence of a real person, organization or opportunity. Exercise topic: ${brief.industry}`,
          'opportunity',
          undefined,
          false,
        ),
      ],
      missing: ['All data on this card is fictional'],
      risks: ['DEMO: don\'t contact or decide on this data'],
    }),
  );
}
