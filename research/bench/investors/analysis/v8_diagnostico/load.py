# Diagnóstico v8 (solo lectura). Uso: cd research/bench/investors/analysis/v8_diagnostico && python3 q0.py (q1..q9)
import json, os, re, glob, statistics as st
from collections import defaultdict, Counter
from urllib.parse import urlparse
B = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))  # research/bench/investors
OUT = B + '/out'
PAIRS = OUT + '/investors-internal-2026-10-09-v5-pairs'
V6 = OUT + '/investors-internal-2026-10-09-v6'
EVSRC = [PAIRS, OUT + '/investors-internal-2026-10-09-v5', OUT + '/quick-v5-2026-10-09', V6]

def investor_gain(l):
    if l.get('identity_correct') is False or (l.get('entity_kind') and l.get('entity_kind') != 'institutional_investor') or l.get('active_status') == 'inactive' or l.get('sector_fit') == 'off' or l.get('hard_eligibility') == 'ineligible' or l.get('overall_relevance') == 'irrelevant': return 0
    hard = any(c.get('criterion_id') in ['INV-ACTIVE','INV-TYPE','INV-STAGE','INV-GEO','INV-CHECK','INV-BUSINESS-MODEL','INV-REGULATORY'] and c.get('state') == 'not_met' for c in l.get('criteria') or [])
    if l.get('active_status') == 'active' and l.get('overall_relevance') == 'strong' and l.get('sector_fit') == 'on' and l.get('hard_eligibility') == 'eligible' and l.get('stage_fit') == 'met' and l.get('geography_fit') == 'met' and not hard: return 3
    if l.get('active_status') in ['active','possibly_active'] and l.get('overall_relevance') == 'plausible' and l.get('sector_fit') in ['on','partial'] and l.get('hard_eligibility') in ['eligible','undetermined'] and not hard: return 2
    return 1

LABELS = {}
for line in open(B + '/gold/v3/labels/adjudicator.jsonl'):
    if line.strip():
        l = json.loads(line); LABELS[(l['case_id'], l['stable_id'])] = l

def host(u):
    try: h = urlparse(u).hostname or ''
    except Exception: h = ''
    return h[4:] if h.startswith('www.') else h
def dom_match(u, d):
    h = host(u); return h == d or h.endswith('.' + d)

GOLD = {}
for p in ['p01','p02','p03','p04','p05','p06']:
    c = json.load(open(f'{B}/cases/inv-case-syn-{p}.json')); a = c['anchors'][0]
    GOLD[p] = dict(stable_id=a['stable_id'], name=a['canonical_name'], domain=a['stable_id'].split('inv:domain:')[1], evidence=a.get('compatibility_evidence'))

def parse_rid(rid):
    m = re.match(r'.*__inv-case-syn-(p\d\d)(-ib)?__(B\w+)__s(\d+)$', rid)
    return dict(case=m.group(1), variant='B' if m.group(2) else 'A', cond=m.group(3), seed=int(m.group(4)))

# events
ev_by_run = defaultdict(list)
for d in EVSRC:
    for line in open(d + '/events.jsonl'):
        try: e = json.loads(line)
        except Exception: continue
        rid = e.get('run_id')
        if rid: ev_by_run[(d, rid)].append(e)

def last_attempt(evs):
    starts = [i for i, e in enumerate(evs) if e['event'] == 'run_start']
    if not starts: return evs
    t0 = evs[starts[-1]]['timestamp']
    return [e for e in evs[starts[-1]:] if e['timestamp'] >= t0]

RUNS = []
for d in [PAIRS, V6]:
    for rd in sorted(glob.glob(d + '/runs/*')):
        f = rd + '/result.json'
        if not os.path.exists(f): continue
        r = json.load(open(f)); rid = r['run_id']; meta = parse_rid(rid)
        evs = None; evsrc = None
        for src in EVSRC:
            cand = ev_by_run.get((src, rid))
            if not cand: continue
            la = last_attempt(cand)
            if any(e['event'] == 'run_end' for e in la): evs = la; evsrc = src; break
        RUNS.append(dict(rid=rid, **meta, r=r, ev=evs or [], evsrc=os.path.basename(evsrc) if evs else None))
def lab(case, sid): return LABELS.get((f'inv-case-syn-{case}', sid))
def lgain(case, sid):
    l = lab(case, sid); return None if l is None else investor_gain(l)
def med(x): return st.median(x) if x else None
def jac(a, b):
    a, b = set(a), set(b)
    return 1.0 if not a and not b else len(a & b) / len(a | b)
