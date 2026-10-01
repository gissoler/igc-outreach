// Tres casos reales de la corrida 23:18 que salieron "apply" siendo incorrectos para el brief Mentiva.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applicantProfile, checkApplicant } from '../server/research/applicant.mjs';

const prof = applicantProfile({ geography: 'GLOBAL (incorporated outside the US and the EU)', entityType: 'for-profit startup', stage: 'seed' });

test('empresas solo como socios permitidos no son elegibles para liderar (NordForsk)', () => {
  const r = checkApplicant('Primary eligible applicants: Research-performing organisations in NordForsk member countries/regions. Permitted partners: Non-academic organisations (industry, public authorities, NGOs) may participate subject to national funder rules.', prof);
  assert.notEqual(r.decision, 'yes');
});

test('una frase de propósito no cuenta como elegibilidad (NSF SBIR)', () => {
  const r = checkApplicant('Supports startups and small businesses in transforming high-risk technologies into commercially impactful products and services that strengthen U.S. competitiveness. Proposals may only be submitted by certain types of organizations. Please see solicitation for details.', prof);
  assert.notEqual(r.decision, 'yes');
  assert.match(r.reason, /defers|another document/i);
});

test('"legally established in the following regions" restringe a esas regiones (UNITE)', () => {
  const r = checkApplicant('Companies (or other close-to-market solution developer); research entities supporting the company. Applicants must be legally established in the following regions providing funding for the UNITE open calls: Region of Central Macedonia, Greece; Lombardy Region, Italy; Extremadura Region, Spain; Aragón Region, Spain. Proposals must be submitted by consortia comprising at least 3 organisations from 3 different UNITE regions.', prof);
  assert.notEqual(r.decision, 'yes');
});

test('NSF: "By investing… in start-ups" es propósito y la página remite a la solicitud', () => {
  const r = checkApplicant('Proposals may only be submitted by certain types of organizations. Please see solicitation for details. In support of this mission, NSF is relaunching its SBIR/STTR programs to invest in startups. By investing federal R&D funds in start-ups and small businesses, NSF strengthens the national economy.', prof);
  assert.equal(r.decision, 'unclear');
});

test('"small business concern" (SBIR/STTR) no se da por elegible para una empresa constituida fuera de EE. UU.', () => {
  const r = checkApplicant('Eligibility Information Who May Submit Proposals: Proposals to any of the NSF SBIR/STTR funding opportunities may only be submitted by firms qualifying as a small business concern.', prof);
  assert.equal(r.decision, 'unclear'); assert.ok(r.flags.includes('us_small_business_concern'));
  const us = applicantProfile({ geography: 'United States', entityType: 'for-profit startup' });
  assert.ok(!checkApplicant('Proposals may only be submitted by firms qualifying as a small business concern.', us).flags.includes('us_small_business_concern'));
});
