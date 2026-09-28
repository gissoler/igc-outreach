import { useState, type CSSProperties, type ReactNode } from 'react';
import type { FactorKey, Recommendation } from './api';

export function CardHead({ title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return <header className="card-head"><h2>{title}</h2>{children}</header>;
}

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const hostOf = (value?: string | null) => {
  if (!value) return '';
  try { return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/** Foto del inversionista si existe (photo_url), si no el logo del fondo por dominio; si nada carga, iniciales. */
export function investorImage(rec: Recommendation): string {
  if (rec.profile.photo_url) return rec.profile.photo_url;
  const host = hostOf(rec.profile.domain) || hostOf(rec.profile.thesis_url);
  return host ? `https://www.google.com/s2/favicons?domain=${host}&sz=256` : '';
}

export function Avatar({ name, src, className = '', children }: { name: string; src?: string; className?: string; children?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  return (
    <span className={`avatar-img ${showImage ? 'has-photo' : ''} ${className}`}>
      {showImage ? <img src={src} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initialsOf(name)}
      {children}
    </span>
  );
}

export const factorLabels: Record<FactorKey, string> = {
  seed: 'Comparables', coinvest: 'Co-inversión', thesis: 'Tesis', path: 'Warm path', activity: 'Actividad',
};
export const outcomeLabels: Record<string, string> = {
  intro_pedida: 'Intro pedida', intro_aceptada: 'Intro aceptada', reunion: 'Reunión',
  dd: 'Due diligence', term_sheet: 'Term sheet', rechazada: 'Rechazada', sin_respuesta: 'Sin respuesta',
};

export const money = (value?: number | null) => {
  if (!value) return '—';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: value >= 1_000_000 ? 'compact' : 'standard' }).format(value);
};
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
export const confidence = (rec: Recommendation) => {
  const best = Math.max(...Object.values(rec.factors || { thesis: 0 }));
  if ((rec.best_path?.weakest || 0) >= .3 || best >= .7) return 'Alta';
  if (best >= .3) return 'Media';
  return 'Exploratoria';
};


export function PageHead({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <div className="page-head"><span>{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>;
}

export function Score({ value, large = false }: { value: number; large?: boolean }) {
  const percent = Math.round(value * 100);
  return <span className={`score ${large ? 'large' : ''}`} style={{ '--score': `${percent * 3.6}deg` } as CSSProperties}><b>{percent}</b>{large && <small>score</small>}</span>;
}
