import { AlertTriangle, CheckCircle2, CircleDashed, CircleHelp, HelpCircle, Info as InfoIcon, RotateCw, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { LinkStatus } from './model';
import { STATUS_HELP, STATUS_LABEL } from './model';

/* Tooltip accesible: se abre con clic, Enter o foco del teclado; se cierra con Escape o clic fuera. */
export function Info({ children, label = 'More info', wide = false }: { children: ReactNode; label?: string; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return <span className="x-info" ref={ref}>
    <button type="button" className="x-info-btn" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}><HelpCircle size={14} /></button>
    {open && <span role="tooltip" id={id} className={`x-info-pop ${wide ? 'wide' : ''}`}>{children}</span>}
  </span>;
}

export function Drawer({ open, onClose, title, subtitle, children, width = 520, tone, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number; tone?: 'demo'; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    last.current = document.activeElement as HTMLElement;
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-autofocus], button, a, input')?.focus(), 30);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => { window.clearTimeout(t); document.removeEventListener('keydown', key); last.current?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="x-drawer-layer" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="x-drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={{ width: `min(${width}px, 100vw)` }} ref={ref}>
      <header className="x-drawer-head">
        <div>{tone === 'demo' && <span className="x-demo-chip">DEMO</span>}<h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button className="x-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <div className="x-drawer-body">{children}</div>
      {footer && <footer className="x-drawer-foot">{footer}</footer>}
    </div>
  </div>;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="x-empty" role="status"><span className="x-empty-ico">{icon || <CircleDashed size={22} />}</span><h3>{title}</h3>{children && <div className="x-empty-body">{children}</div>}{action && <div className="x-empty-act">{action}</div>}</div>;
}
export function ErrorState({ title = 'Something went wrong', message, onRetry, children }: { title?: string; message: string; onRetry?: () => void; children?: ReactNode }) {
  return <div className="x-error" role="alert"><AlertTriangle size={18} /><div><b>{title}</b><p>{message}</p>{children}</div>{onRetry && <button className="x-btn sm" onClick={onRetry}><RotateCw size={14} /> Retry</button>}</div>;
}
export function SkeletonState({ rows = 3, label = 'Loading…', variant = 'block' }: { rows?: number; label?: string; variant?: 'block' | 'cards' | 'dashboard' }) {
  return <div className={`x-skel ${variant}`} role="status" aria-live="polite" aria-label={label}>
    {variant === 'dashboard' && <div className="x-skel-kpis">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div>}
    {Array.from({ length: rows }, (_, i) => <i key={i} style={{ width: `${92 - i * 11}%` }} />)}
    <span className="x-sr">{label}</span>
  </div>;
}

const STATUS_ICON: Record<LinkStatus, ReactNode> = { verified: <CheckCircle2 size={13} />, documented: <InfoIcon size={13} />, hypothesis: <CircleHelp size={13} /> };
export function LinkBadge({ status, compact = false }: { status: LinkStatus; compact?: boolean }) {
  return <span className={`x-link ${status}`} title={STATUS_HELP[status]}>{STATUS_ICON[status]}{compact ? STATUS_LABEL[status].split(' ·')[0] : STATUS_LABEL[status]}</span>;
}
export function ConfBadge({ value }: { value: string }) {
  const bars = value === 'alta' ? 3 : value === 'media' ? 2 : 1;
  return <span className={`x-conf c${bars}`} title="Data confidence (not a probability)"><i /><i /><i /><b>{({ alta: 'High', media: 'Medium', baja: 'Low' } as Record<string, string>)[value] || value} confidence</b></span>;
}
export function BucketBadge({ bucket }: { bucket: string }) {
  const label = bucket === 'top' ? 'Priority' : bucket === 'radar' ? 'Radar' : 'Discarded';
  const glyph = bucket === 'top' ? '▲' : bucket === 'radar' ? '◆' : '✕';
  return <span className={`x-bucket ${bucket}`}><span aria-hidden="true">{glyph}</span>{label}</span>;
}
export function ScorePill({ score, big = false }: { score: number; big?: boolean }) {
  return <span className={`x-score ${big ? 'big' : ''}`} title="Priority score 0–100. Ranks candidates; not a probability of investment."><b>{score}</b><small>/100</small></span>;
}
export function Meter({ value, max = 1, tone = 'blue', label }: { value: number; max?: number; tone?: 'blue' | 'gold' | 'green' | 'amber' | 'red' | 'ink'; label?: string }) {
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <span className={`x-meter ${tone}`} role="img" aria-label={label || `${Math.round(pct)}%`}><i style={{ width: `${pct}%` }} /></span>;
}
export function DemoRibbon() {
  return <div className="x-demo-ribbon" role="note"><b>DEMO DATA</b><span>Fictional people, organizations and links. Same scoring logic as real evaluations.</span></div>;
}
