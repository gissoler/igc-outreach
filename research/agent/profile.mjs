/**
 * Convierte entradas heredadas en perfiles trazables.
 * No infiere valores que la fuente no proporciona.
 * Contratos: profile/1.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { validate } from './contracts.mjs';

const PATHS = [
  'applicant.name',
  'applicant.entity_type',
  'applicant.country',
  'applicant.region',
  'applicant.small_business',
  'applicant.ownership_us_51',
  'applicant.employees',
  'applicant.partners',
  'applicant.can_cost_share',
  'project.title',
  'project.summary',
  'project.sector',
  'project.work_type',
  'project.stage',
  'project.foreign_components',
  'team.pi.country_residence',
  'team.pi.primary_employer_is_applicant',
  'team.pi.credentials',
  'funding.amount_needed_usd',
  'funding.instruments_accepted',
  'funding.routes_accepted',
  'preferences.min_prep_days',
  'preferences.excluded_funders',
];

const COUNTRY = {
  unitedstates: 'US',
  usa: 'US',
  us: 'US',
  colombia: 'CO',
  canada: 'CA',
  mexico: 'MX',
  spain: 'ES',
  españa: 'ES',
  unitedkingdom: 'GB',
  uk: 'GB',
  brazil: 'BR',
  brasil: 'BR',
  argentina: 'AR',
  chile: 'CL',
  peru: 'PE',
  ecuador: 'EC',
  france: 'FR',
  germany: 'DE',
  india: 'IN',
  australia: 'AU',
};

const ENTITY = {
  nonprofit: 'nonprofit',
  ngo: 'nonprofit',
  foundation: 'nonprofit',
  university: 'academic',
  academic: 'academic',
  'for-profit': 'for_profit',
  company: 'for_profit',
  startup: 'for_profit',
  government: 'government',
  individual: 'individual',
};

const stages = new Set([
  'idea',
  'prototype',
  'preclinical',
  'clinical_phase_1',
  'clinical_phase_2',
  'clinical_phase_3',
  'marketed',
  'other',
]);

const slug = value => (
  String(value || 'profile')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') ||
  'profile'
);

function country(value) {
  const text = String(value || '').trim();
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  const key = text.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
  return COUNTRY[key] || null;
}

function entity(value) {
  return ENTITY[String(value || '').toLowerCase()] || null;
}

function build(values, {
  as_of,
  source_name = 'legacy-brief.json',
  profile_id,
  locator = source_name,
  source_kind = 'legacy_brief',
}) {
  const fields = {};
  for (const path of PATHS) {
    const item = values[path] || { value: null, source: 'not provided' };
    fields[path] = {
      value: item.value ?? null,
      source: item.source || 'not provided',
      as_of,
      quote: null,
    };
  }
  return validate('profile', {
    schema_version: 'profile/1',
    profile_id: profile_id || `prof-${slug(values['applicant.name']?.value || source_name)}`,
    subject_type: 'organization',
    target_types: ['grant'],
    as_of,
    provenance: {
      source_kind,
      sources: [{ title: source_name, locator, retrieved_at: as_of }],
      built_by: 'code',
      builder_saw_anchor: false,
    },
    fields,
  });
}

function sectors(industry) {
  if (!industry) return null;
  if (!industry.includes(',') && !industry.includes(';')) return [industry];
  return industry.split(/[,;]/).map(value => value.trim()).filter(Boolean);
}

/**
 * Convierte un brief legado sin completar campos ausentes.
 * Puro respecto de red, disco y reloj.
 * Excepción de 60 líneas: el mapeo literal conserva visible la procedencia de cada campo.
 * @param {object} brief Brief legado.
 * @param {object} meta Fecha, fuente, locator e identidad opcional.
 * @returns {object} Perfil validado con procedencia por campo.
 */
export function briefToProfile(brief, meta) {
  const sourceName = meta.source_name || 'legacy-brief.json';
  const source = key => `legacy_brief: ${sourceName}#${key}`;
  const industry = String(brief.industry || '').trim();
  const values = {
    'applicant.name': {
      value: brief.company || brief.venture || null,
      source: source(brief.company ? 'company' : 'venture'),
    },
    'applicant.entity_type': {
      value: entity(brief.entityType),
      source: brief.entityType ? source('entityType') : 'not provided',
    },
    'applicant.country': {
      value: country(brief.country),
      source: brief.country ? source('country') : 'not provided',
    },
    'applicant.region': {
      value: brief.state || null,
      source: brief.state ? source('state') : 'not provided',
    },
    'project.title': {
      value: brief.product || null,
      source: brief.product ? source('product') : 'not provided',
    },
    'project.summary': {
      value: brief.description || brief.oneLiner || null,
      source: brief.description
        ? source('description')
        : brief.oneLiner
          ? source('oneLiner')
          : 'not provided',
    },
    'project.sector': {
      value: sectors(industry),
      source: industry ? source('industry') : 'not provided',
    },
    'project.work_type': { value: null, source: 'not provided' },
    'project.stage': {
      value: stages.has(brief.stage) ? brief.stage : null,
      source: brief.stage ? source('stage') : 'not provided',
    },
    'funding.amount_needed_usd': {
      value: typeof brief.amount === 'number' ? brief.amount : null,
      source: typeof brief.amount === 'number' ? source('amount') : 'not provided',
    },
    'funding.instruments_accepted': {
      value: Array.isArray(brief.fundingTypes) &&
        brief.fundingTypes.length === 1 &&
        brief.fundingTypes[0] === 'grant'
        ? ['grant', 'prize', 'cooperative_agreement']
        : null,
      source: brief.fundingTypes ? source('fundingTypes') : 'not provided',
    },
    'funding.routes_accepted': { value: null, source: 'not provided' },
  };
  return build(values, {
    ...meta,
    source_name: sourceName,
    locator: meta.locator || sourceName,
    source_kind: 'legacy_brief',
  });
}

/**
 * Adapta el estado del intake y cambia explícitamente su procedencia.
 * Puro respecto de red, disco y reloj.
 * @param {object} intakeState Estado plano o anidado del intake.
 * @param {object} meta Fecha y metadatos de procedencia.
 * @returns {object} Perfil validado con source_kind intake.
 */
export function intakeToProfile(intakeState, meta) {
  const brief = {
    company: intakeState['company.name'] ?? intakeState.company?.name,
    entityType: intakeState['company.entity_type'] ?? intakeState.company?.entity_type,
    country: intakeState['company.country'] ?? intakeState.company?.country,
    state: intakeState['company.state'] ?? intakeState.company?.state,
    product: intakeState['product.title'] ?? intakeState.product?.title,
    description: intakeState['product.description'] ?? intakeState.product?.description,
    industry: intakeState['product.industry'] ?? intakeState.product?.industry,
    stage: intakeState['product.stage'] ?? intakeState.product?.stage,
    amount: intakeState['funding.amount'],
    fundingTypes: intakeState['funding.types'],
  };
  const profile = briefToProfile(brief, {
    ...meta,
    source_name: meta.source_name || 'intake',
  });
  profile.provenance.source_kind = 'intake';
  for (const field of Object.values(profile.fields)) {
    field.source = field.source.replace(/^legacy_brief:/, 'intake:');
  }
  return validate('profile', profile);
}
