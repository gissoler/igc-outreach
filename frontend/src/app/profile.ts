import type { AccountSession } from '../accountApi';
import type { ProjectConfig } from '../api';
import type { Brief } from '../researchApi';

export type ResearchPrefs = { mode: 'strategic' | 'financial'; minDays: number; useApify: boolean; deadlineFrom?: string; deadlineTo?: string };
export type Profile = NonNullable<AccountSession['profile']> & { research_prefs?: Partial<ResearchPrefs> };
export const DEFAULT_PREFS: ResearchPrefs = { mode: 'strategic', minDays: 30, useApify: true };
export const prefsOf = (p: Profile | null | undefined): ResearchPrefs => ({ ...DEFAULT_PREFS, ...p?.research_prefs });

/** Brief de investigación = perfil confirmado (contrato existente) + preferencias de puntuación. */
export function briefFor(profile: Profile): Brief {
  const prefs = prefsOf(profile);
  return { ...briefFromProfile(profile), mode: prefs.mode, minDays: prefs.minDays, useApify: prefs.useApify };
}

/* El perfil confirmado alimenta la investigación con TODO el prerregistro: quién busca (organización)
   y para qué empresa, objetivos, madurez, ronda, monto, criterios, restricciones y competidores. */
export function briefFromProfile(profile: ProjectConfig & { onboardingComplete?: boolean }): Brief {
  const intake=profile.intake;
  const legacy=[...new Set((profile.project.funding_types||[]).map(value=>value==='grant'?'grant':value==='debt'?'debt':'investment'))];
  const fundingTypes=intake?.objectives?.length?intake.objectives:legacy;
  const grantOnly=fundingTypes.includes('grant')&&!fundingTypes.includes('investment');
  const organization=profile.founder.org;
  const venture=profile.project.venture||organization;
  const list=(v?:string[])=>(v||[]).filter(Boolean).join('; ');
  const namedCompetitors=(intake?.competitors||[]).filter((name)=>!/^\s*(apps?|tools?|classes|events?|professionals?|tests?|therapy|therapists?|coaches?|coaching|content|meditation|journaling|wellness)\b/i.test(name)&&name.trim().split(/\s+/).length<=8);
  return {name:profile.founder.name||'Founder',role:profile.founder.title||'Founder',company:organization,organization,venture,relation:profile.project.relation||'same',
    product:profile.project.name,description:[profile.project.description||profile.project.one_liner,intake?.target_population?`Target population: ${intake.target_population}`:'',intake?.applicant_role?`Applicant route: ${intake.applicant_role}`:''].filter(Boolean).join('\n').slice(0,3000),oneLiner:(profile.project.one_liner||'').slice(0,300),
    industry:([...(profile.project.sectors||[]),...(intake?.search_terms||[])].join('; ')||profile.project.one_liner).slice(0,500),stage:intake?.maturity||'other',round:grantOnly?'':profile.project.stage||'',
    geography:(profile.project.geo.join(', ')||'Global').slice(0,200),fundingTypes:fundingTypes.length?fundingTypes:['investment'],amount:profile.project.raise_usd||'',
    criteria:list(intake?.criteria).slice(0,1000),constraints:list(intake?.constraints).slice(0,1000),useOfFunds:(intake?.use_of_funds||'').slice(0,500),
    entityType:intake?.entity_type||'',country:(intake?.country||'').slice(0,60),state:(intake?.state||'').slice(0,80),city:(intake?.city||'').slice(0,80),timeline:(intake?.timeline||'').slice(0,100),website:(intake?.website||'').slice(0,300),applicantRole:(intake?.applicant_role||'').slice(0,40),targetPopulation:(intake?.target_population||'').slice(0,500),searchTerms:(intake?.search_terms||[]).join('; ').slice(0,500),exclusions:namedCompetitors.join(', ').slice(0,1000),
    event:'',minDays:30,mode:'strategic',dataMode:'live',useTeam:/\bigc\b/i.test(organization),useApify:true,excludeCompetitors:Boolean(namedCompetitors.length),strictTypes:false,linkedinUrl:profile.founder.linkedin_url||''};
}
