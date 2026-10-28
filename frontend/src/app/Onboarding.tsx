/* ─────────────────────────────────────────────────────────────────────────────
   OnboardingWorkspace (27-10): everything the search needs is entered in the conversation.
   No Company / Product / Goal / Review forms: the assistant extracts several facts per message,
   keeps documents with provenance, accepts corrections, shows what it understood and what is
   still unknown, and starts the search from the chat. The structured profile stays internal.
   Importing contacts (network) remains an optional page, reached from the account menu.
   ───────────────────────────────────────────────────────────────────────────── */
import { CheckCircle2, Link2, LoaderCircle, Network, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountApi, ApiError, intakeApi, type AccountSession, type AccountSource, type IntakeState, type NetworkGraphData } from '../accountApi';
import { AgentChat } from '../IntakeAgent';
import type { Job } from '../researchApi';
import { fmtDateTime, fmtInt } from './format';
import { NetworkGraph } from './NetworkGraph';
import { prefsOf, type Profile, type ResearchPrefs } from './profile';
import { PageHeader } from './Shell';
import { EmptyState, ErrorState, SkeletonState } from './ui';

export type SectionId = 'asistente' | 'red';
export const SECTIONS: { id: SectionId; label: string }[] = [{ id: 'asistente', label: 'Conversation' }, { id: 'red', label: 'Your network (optional)' }];
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Couldn\'t save.');

function NetworkSection({ session, profile, ensureProfile, prefs, setPrefs, onError }: { session: AccountSession; profile: Profile | null; ensureProfile: () => Promise<Profile | null>; prefs: ResearchPrefs; setPrefs: (p: Partial<ResearchPrefs>) => void; onError: (e: string) => void }) {
  const [sources, setSources] = useState<AccountSource[] | null>(null);
  const [graph, setGraph] = useState<NetworkGraphData | null>(null);
  const [linkedinReady, setLinkedinReady] = useState<boolean | null>(null);
  const [url, setUrl] = useState(profile?.founder.linkedin_url || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [origin, setOrigin] = useState('linkedin');
  const [howto, setHowto] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [manualName, setManualName] = useState(profile?.founder.name || session.profile?.founder.name || session.user.name || '');
  const [manualRole, setManualRole] = useState(profile?.founder.title || session.profile?.founder.title || '');
  const [manualOrg, setManualOrg] = useState(profile?.founder.org || session.profile?.founder.org || '');
  const refresh = useCallback(() => {
    void accountApi.sources().then(setSources).catch(() => setSources([]));
    void accountApi.networkGraph().then(setGraph).catch(() => setGraph(null));
  }, []);
  useEffect(() => { refresh(); void accountApi.connectors().then((c) => setLinkedinReady(Boolean(c.linkedin?.configured))).catch(() => setLinkedinReady(false)); }, [refresh]);
  const run = async (key: string, fn: () => Promise<string>) => { setBusy(key); setMsg(''); onError(''); try { const p = await ensureProfile(); if (!p) { onError('Before connecting your network, add your company, product, one-liner and goal.'); return; } setMsg(await fn()); refresh(); } catch (e) { onError(errorText(e)); } finally { setBusy(null); } };
  const analyzeLinkedIn = async () => {
    setBusy('li'); setMsg(''); onError(''); setNotFound(false);
    try {
      const p = await ensureProfile();
      if (!p) { onError('Before connecting your network, add your company, product, one-liner and goal.'); return; }
      const r = await accountApi.connectLinkedIn(url);
      const fromSetup = /setup/i.test(r.linkedin.source || '');
      setMsg(fromSetup
        ? `Your LinkedIn isn't indexed publicly, so we used your setup name (${r.linkedin.name}): ${r.interactions.count} people who appear with you online.`
        : `${r.linkedin.name || 'Profile'} verified: ${r.interactions.count} people who appear with you online.`);
      refresh();
    } catch (e) {
      if ((e instanceof ApiError && e.code === 'linkedin_not_found') || /find that profile publicly/i.test(e instanceof Error ? e.message : '')) setNotFound(true);
      else onError(errorText(e));
    } finally { setBusy(null); }
  };
  const saveManual = async () => {
    setBusy('li-manual'); setMsg(''); onError('');
    try {
      const p = await ensureProfile();
      if (!p) { onError('Before connecting your network, add your company, product, one-liner and goal.'); return; }
      const r = await accountApi.connectLinkedIn(url, { name: manualName.trim(), role: manualRole.trim(), organization: manualOrg.trim() });
      setNotFound(false);
      setMsg(`${r.linkedin.name || 'Profile'} saved: ${r.interactions.count} people who appear with you online.`);
      refresh();
    } catch (e) { onError(errorText(e)); } finally { setBusy(null); }
  };
  const ORIGINS: Record<string, { label: string; accept: string; steps: string[] }> = {
    linkedin: { label: 'My LinkedIn connections', accept: '.csv', steps: ['In LinkedIn, open Me → Settings & Privacy → Data privacy.', 'Choose "Get a copy of your data" and select only Connections.', 'LinkedIn emails you the file in minutes. Upload it as is.'] },
    gmail: { label: 'My Google / Gmail contacts', accept: '.csv', steps: ['Open contacts.google.com.', 'Click Export and choose Google CSV.', 'Upload the downloaded file.'] },
    outlook: { label: 'My Outlook contacts', accept: '.csv', steps: ['In Outlook, open People → Manage contacts → Export contacts.', 'Upload the downloaded file.'] },
    calendar: { label: 'My calendar (meetings)', accept: '.ics', steps: ['Google Calendar: Settings → Import & export → Export (unzip and use the .ics).', 'Outlook desktop: File → Save calendar.', 'We only use who you met, never meeting content.'] },
    hubspot: { label: 'My CRM (HubSpot)', accept: '.csv', steps: ['HubSpot: Contacts → Export view.', 'Upload the downloaded file.'] },
    apollo: { label: 'My Apollo list', accept: '.csv', steps: ['Apollo: select contacts → Export.', 'Upload the downloaded file.'] },
  };
  const importFile = (file: File) => run('file', async () => { const text = await file.text(); const r = await accountApi.importSource(origin, text, file.name); return `Done: ${fmtInt(r.count)} contacts added from ${file.name}.`; });
  const stub: Job = useMemo(() => ({ id: 'net', brief: { name: session.profile?.founder.name || session.user.name, role: session.profile?.founder.title || '', company: session.profile?.founder.org || '', product: '', description: '', industry: '', stage: 'other', geography: '', fundingTypes: ['investment'], amount: null, criteria: '', exclusions: '', event: '', minDays: 30, mode: 'strategic', dataMode: 'live', useTeam: false, useApify: false, excludeCompetitors: false, strictTypes: false }, mode: 'live', status: 'done', createdAt: new Date().toISOString(), events: [], leads: [], senderEvidence: [] }), [session]);
  const li = profile?.linkedin_interactions;
  const label: Record<string, string> = { linkedin: 'LinkedIn connections', linkedin_interactions: 'Your public LinkedIn activity', web_relations: 'People who appear with you online', linkedin_authenticated_graph: 'Verified LinkedIn connections', gmail: 'Google contacts', outlook: 'Outlook contacts', calendar: 'Calendar', hubspot: 'HubSpot', apollo: 'Apollo' };
  const o = ORIGINS[origin];
  return <div className="ow-net">
    <div className="ow-net-sum">
      <div><b>{graph ? fmtInt(graph.summary.people) : '—'}</b><span>people in your network</span></div>
      <div><b>{graph ? fmtInt(graph.summary.verified) : '—'}</b><span>confirmed relationships</span></div>
      <div><b>{graph ? fmtInt(graph.summary.public) : '—'}</b><span>public interactions</span></div>
      <div><b>{graph ? fmtInt(graph.summary.mutualPaths) : '—'}</b><span>mutual contacts with candidates</span></div>
    </div>
    <div className="ow-net-grid">
      <article className="ow-src"><header><Link2 size={16} /><b>1 · Your LinkedIn profile</b>{li?.status === 'ready' ? <span className="x-state ok">{li.count} people found</span> : <span className="x-state empty">Not analyzed</span>}</header>
        <p>Paste your profile link. We find people who appear with you on the public web. No password needed.</p>
        <div className="x-row"><input aria-label="Your LinkedIn profile link" value={url} onChange={(e) => { setUrl(e.target.value); setNotFound(false); }} placeholder="linkedin.com/in/your-name" /><button className="x-btn primary" disabled={!!busy || !url.trim() || linkedinReady === false} onClick={() => void analyzeLinkedIn()}>{busy === 'li' ? <LoaderCircle size={14} className="spin" /> : null} Analyze my LinkedIn</button></div>
        {linkedinReady === false && <small className="x-muted">Not enabled for your org yet. Upload contacts meanwhile.</small>}
        {li?.updatedAt && <small className="x-muted">Last run: {fmtDateTime(li.updatedAt)}. Takes up to 3 minutes; small cost.</small>}
        {notFound && <div className="x-callout warn"><b>We couldn't find your LinkedIn profile publicly.</b><span>Help us with your name and role below and we'll build your network from what you enter, instead of the public link.</span>
          <div className="ow-grid">
            <label className="x-field"><span>Your name</span><input aria-label="Your name" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="e.g. Ada Lovelace" /></label>
            <label className="x-field"><span>Your role</span><input aria-label="Your role" value={manualRole} onChange={(e) => setManualRole(e.target.value)} placeholder="e.g. CEO, founder" /></label>
            <label className="x-field"><span>Organization</span><input aria-label="Your organization" value={manualOrg} onChange={(e) => setManualOrg(e.target.value)} placeholder="e.g. Mentiva" /></label>
          </div>
          <div className="x-row"><button className="x-btn primary" disabled={!!busy || !manualName.trim()} onClick={() => void saveManual()}>{busy === 'li-manual' ? <LoaderCircle size={14} className="spin" /> : null} Save and continue</button></div>
        </div>}
      </article>
      <article className="ow-src"><header><Upload size={16} /><b>2 · Your contacts</b></header>
        <p>The most reliable way to find who you really know. Only you see it.</p>
        <label className="x-field"><span>Where is the list from?</span><select value={origin} onChange={(e) => { setOrigin(e.target.value); setHowto(false); }}>{Object.entries(ORIGINS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label className="ow-upload"><Upload size={15} /> {busy === 'file' ? 'Uploading…' : 'Choose file'}<input type="file" accept={o.accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} /></label>
        <button className="x-link-btn" aria-expanded={howto} onClick={() => setHowto(!howto)}>How do I export this?</button>
        {howto && <ol className="ow-howto">{o.steps.map((x) => <li key={x}>{x}</li>)}</ol>}
      </article>
    </div>
    {msg && <p className="x-note" role="status"><CheckCircle2 size={14} /> {msg}</p>}
    <h3 className="x-h3">Connected</h3>
    {sources === null ? <SkeletonState rows={2} /> : sources.length ? <table className="x-table"><thead><tr><th scope="col">Source</th><th scope="col" className="num">People</th><th scope="col">Updated</th><th /></tr></thead><tbody>{sources.map((x) => <tr key={x.source}><th scope="row">{label[x.source] || x.source}</th><td className="num">{fmtInt(x.count)}</td><td>{fmtDateTime(x.updatedAt)}</td><td>{['linkedin', 'gmail', 'outlook', 'calendar', 'hubspot', 'apollo'].includes(x.source) && <button className="x-link-btn" onClick={() => void run(`rm-${x.source}`, async () => { await accountApi.disconnectSource(x.source); return `${label[x.source]}: disconnected.`; })}>Remove</button>}</td></tr>)}</tbody></table>
      : <EmptyState icon={<Network size={20} />} title="No contacts connected yet">Without your network, every outreach is cold.</EmptyState>}
    <label className="ow-toggle"><input type="checkbox" checked={prefs.useApify} onChange={(e) => setPrefs({ useApify: e.target.checked })} disabled={!profile} /><span><b>Find the decision-maker at each organization</b><small>Small cost per use. Turn off for a free evaluation.</small></span></label>
    {graph && graph.nodes.length > 1 && <NetworkGraph job={stub} account={graph} selectedLeadId={null} onSelectLead={() => undefined} onInspect={() => undefined} height={380} mode="network" />}
  </div>;
}

/* ───────── Workspace ───────── */
export function OnboardingWorkspace({ session, section, onDone, onSession, onIntake, onBack }: {
  session: AccountSession; section: SectionId;
  onDone: (profile: Profile, run: boolean) => void; onSession: (s: AccountSession) => void;
  onIntake?: (i: IntakeState | null) => void; onBack?: () => void;
}) {
  const [intake, setIntakeState] = useState<IntakeState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const profile = (session.profile as Profile | null) || null;
  const [prefs, setPrefsState] = useState<ResearchPrefs>(() => prefsOf(profile));
  const setIntake = useCallback((i: IntakeState) => { setIntakeState(i); onIntake?.(i); }, [onIntake]);
  const load = useCallback(() => { setLoadError(''); void intakeApi.get().then(setIntake).catch((e) => setLoadError(errorText(e))); }, [setIntake]);
  useEffect(load, [load]);
  const setPrefs = async (patch: Partial<ResearchPrefs>) => {
    const next = { ...prefs, ...patch }; setPrefsState(next);
    if (!profile) return;
    try { const p = await accountApi.saveProfile({ ...profile, research_prefs: next } as Profile); onSession({ ...session, profile: p }); } catch (e) { setError(errorText(e)); }
  };
  /** Confirms the conversation into a profile (needed to connect the network). */
  const ensureProfile = async (): Promise<Profile | null> => {
    if (profile) return profile;
    if (!intake?.readiness?.canStart) return null;
    const r = await intakeApi.confirm();
    const p = await accountApi.saveProfile({ ...r.profile, onboardingComplete: false, research_prefs: prefs } as Profile);
    onSession({ ...session, profile: p }); setIntake(r.intake);
    return p as Profile;
  };
  const finish = async (run: boolean) => {
    setBusy(true); setError('');
    try {
      const r = await intakeApi.confirm();
      setIntake(r.intake);
      const merged = { ...profile, ...r.profile, linkedin_profile: profile?.linkedin_profile ?? r.profile.linkedin_profile, linkedin_interactions: profile?.linkedin_interactions ?? r.profile.linkedin_interactions, research_prefs: prefs, onboardingComplete: true } as Profile;
      const p = await accountApi.saveProfile(merged);
      onSession({ ...session, profile: p });
      onDone(p as Profile, run);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (loadError) return <div className="ow"><ErrorState title="Couldn't load the conversation" message={loadError} onRetry={load} /></div>;
  if (!intake) return <div className="ow"><SkeletonState rows={6} label="Loading the conversation…" /></div>;
  if (section === 'red') return <div className="ow ow-single"><main className="ow-main">
    <PageHeader crumb="Optional" title="Your network" meta="Contacts you import are only used to look for real introduction paths. Nothing is sent." actions={onBack && <button className="x-btn sm" onClick={onBack}>Back</button>} />
    {error && <ErrorState message={error} onRetry={() => setError('')} title="Something failed" />}
    <NetworkSection session={session} profile={profile} ensureProfile={ensureProfile} prefs={prefs} setPrefs={(p) => void setPrefs(p)} onError={setError} />
  </main></div>;
  return <div className="ow ow-single ow-chat-only">
    <main className="ow-main">
      {error && <ErrorState message={error} onRetry={() => setError('')} title="Couldn't start" />}
      <div className="ow-ai solo"><div className="ow-ai-chat">
        <AgentChat intake={intake} onChange={setIntake} onError={setError} title="" description="" onRun={() => void finish(true)} running={busy} />
      </div></div>
    </main>
  </div>;
}
