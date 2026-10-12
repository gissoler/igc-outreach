from load import *
E = [r for r in RUNS if r['cond']=='B2E']
keys = Counter(); bkeys = Counter()
for r in E:
    for e in r['ev']:
        if e['event']=='relevance_filter':
            keys.update(e.keys())
            for b in e.get('blocks') or []: bkeys.update(b.keys())
print(keys, bkeys)
# paired B2 runs
def b2(p): return [r for r in RUNS if r['cond']=='B2' and r['variant']=='A' and r['case']==p and r['seed']==101][0]
tot = Counter()
disc_sim = []; disc_llm = []; kept = []
for r in E:
    p = r['case']; rf = [e for e in r['ev'] if e['event']=='relevance_filter']
    B2r = b2(p); b2ents = {e['stable_id'].split('inv:domain:')[-1] for e in B2r['r']['entities']}
    b2g2 = {e['stable_id'].split('inv:domain:')[-1] for e in B2r['r']['entities'] if (lgain(p, e['stable_id']) or 0) >= 2}
    e2ents = {e['stable_id'].split('inv:domain:')[-1] for e in r['r']['entities']}
    allents = set()
    for rr in RUNS:
        if rr['case']==p: allents |= {e['stable_id'].split('inv:domain:')[-1] for e in rr['r']['entities']}
    c = Counter()
    for e in rf:
        urls = e['urls']; sim = {x['i']: x['sim'] for x in e.get('similarity') or []}
        top = set(i for b in e.get('blocks') or [] for i in b['indices']); kp = set(e.get('kept') or [])
        for i, u in enumerate(urls):
            h = host(u); lg = lgain(p, 'inv:domain:'+h)
            st_ = 'kept' if i in kp else 'drop_llm' if i in top else 'drop_sim'
            c[st_] += 1
            row = dict(case=p, url=u, sim=sim.get(i), stage=st_, label_gain=lg, in_any_run=h in allents, in_B2_s101=h in b2ents, b2_g2=h in b2g2, query=e['query'][:80])
            (kept if st_=='kept' else disc_llm if st_=='drop_llm' else disc_sim).append(row)
            if lg is not None: c[(st_, 'label', lg)] += 1
            if h in allents: c[(st_, 'firma aceptada en alguna corrida del caso')] += 1
            if h in b2g2: c[(st_, 'g2 de B2 s101')] += 1
    tot.update(c)
    print(p, 'eventos', len(rf), dict(c))
    print('  B2 s101 g2 etiqueta', b2g2, '-> en B2E entidades:', b2g2 & e2ents)
print('TOTAL', dict(tot))
import random
random.seed(1)
def show(rows, n):
    for x in rows[:n]: print('  ', x['case'], x['stage'], x['sim'], 'etq', x['label_gain'], 'aceptada_en_otra', x['in_any_run'], x['url'][:95])
print('\nDESCARTES con etiqueta o firma conocida:')
show([x for x in disc_sim + disc_llm if x['label_gain'] is not None or x['in_any_run']], 40)
print('\nmuestra descartes (10):'); show(random.sample(disc_sim, 5) + random.sample(disc_llm, 5), 10)
print('\nmuestra conservados (10):'); show(random.sample(kept, 10), 10)
# similitudes
import statistics
for nm, rows in [('kept', kept), ('drop_llm', disc_llm), ('drop_sim', disc_sim)]:
    s = [x['sim'] for x in rows if x['sim'] is not None]
    print(nm, len(rows), 'cos med', round(statistics.median(s),4), 'min', min(s), 'max', max(s))
# rank cutoff: diferencia coseno entre rank10 y rank11
gaps = []
for r in E:
    for e in r['ev']:
        if e['event']=='relevance_filter' and len(e.get('similarity') or []) > 10:
            s = [x['sim'] for x in e['similarity']]; gaps.append((s[9], s[10], s[0], s[-1]))
print('cos rank10 med', round(statistics.median(g[0] for g in gaps),4), 'rank11 med', round(statistics.median(g[1] for g in gaps),4), 'rango top', round(statistics.median(g[2] for g in gaps),4), 'último', round(statistics.median(g[3] for g in gaps),4))
print('B2 vs B2E totales (p01,p03,p05 s101):')
for k in ['searches','fetches','rejected_non_investors']:
    print(k, sum(b2(r['case'])['r']['totals'][k] for r in E), sum(r['r']['totals'][k] for r in E))
print('aceptadas', sum(len(b2(r['case'])['r']['entities']) for r in E), sum(len(r['r']['entities']) for r in E))
print('g2 etiqueta', sum(sum(1 for e in b2(r['case'])['r']['entities'] if (lgain(r['case'], e['stable_id']) or 0)>=2) for r in E), sum(sum(1 for e in r['r']['entities'] if (lgain(r['case'], e['stable_id']) or 0)>=2) for r in E))
print('etiquetadas', sum(sum(1 for e in b2(r['case'])['r']['entities'] if lgain(r['case'], e['stable_id']) is not None) for r in E), sum(sum(1 for e in r['r']['entities'] if lgain(r['case'], e['stable_id']) is not None) for r in E))
for r in E: print(r['case'], 'B2E', r['r']['relevance_filter'], r['r'].get('sparse_after_round_2'), r['r'].get('accepted_after_round_2'), r['r'].get('rounds_completed_at_stop'), r['r']['stop_reason'])
