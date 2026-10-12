from load import *
START = '2026-10-11T23:00:00Z'
paid = Counter(); allc = Counter()
for d in [PAIRS, V6, OUT+'/investors-internal-2026-10-09-v5', OUT+'/quick-v5-2026-10-09']:
    for l in open(d+'/events.jsonl'):
        e = json.loads(l)
        if e.get('event')!='search_end' or e['timestamp'] < START: continue
        for a in e.get('attempts') or []:
            if a['provider']=='exa':
                allc[os.path.basename(d)] += 1
                if not a.get('cached'): paid[os.path.basename(d)] += 1
print('exa llamadas desde', START, dict(allc), 'no cacheadas', dict(paid), 'total', sum(paid.values()), 'USD/llamada si 7 USD:', round(7/sum(paid.values()),4))
# split search types in B2
for cond in ['B2','B2E','B1']:
    rs = [r for r in RUNS if r['cond']==cond]; c = Counter(); cp = Counter()
    for r in rs:
        op = {e['query'] for e in r['ev'] if e['event']=='search_opened'}
        dq = set()
        for e in r['ev']:
            if e['event']=='deepening_end':
                for pg in e.get('pages') or []:
                    if 'query' in pg: dq.add(pg['query'])
        rq = {e['name'] for e in r['ev'] if e['event']=='resolution_start'}
        for e in r['ev']:
            if e['event']!='search_end': continue
            k = 'principal' if e['query'] in op else 'profundización' if (e['query'] in dq or e.get('include_domains')) else 'resolución' if e['query'].startswith('"') else 'otra'
            c[k] += 1
            cp[k] += sum(1 for a in e.get('attempts') or [] if a['provider']=='exa' and not a.get('cached'))
    print(cond, 'búsquedas por tipo', dict(c), 'exa no cacheadas por tipo', dict(cp))
# firmas perdidas por missing_literal_quote: host rechazado con kind investor, nunca aceptado en la corrida
lost = Counter(); lostg = []
for r in [r for r in RUNS if r['cond']=='B2']:
    ent = {e['stable_id'].split('inv:domain:')[-1] for e in r['r']['entities']}
    hosts = defaultdict(list)
    for e in r['ev']:
        if e['event']=='extract_end': hosts[host(e['url'])].append(e)
    for h, es in hosts.items():
        if any(e['accepted'] for e in es) or any(h == d or h.endswith('.'+d) for d in ent): continue
        kinds = Counter(e.get('rejected_kind') for e in es)
        if any(e.get('kind')=='institutional_investor' for e in es):
            k = 'missing_literal_quote' if kinds.get('missing_literal_quote') else kinds.most_common(1)[0][0]
            lost[k] += 1
            lg = lgain(r['case'], 'inv:domain:'+h)
            if lg is not None: lostg.append((r['case'], h, k, lg))
print('B2: dominios con página de inversor que nunca se aceptaron en la corrida, por motivo', dict(lost), 'total', sum(lost.values()))
print('de ellos con etiqueta', len(lostg), 'gain>=2', sum(1 for x in lostg if x[3]>=2), Counter((x[2], x[3]) for x in lostg))
print(sorted(set((x[0], x[1], x[2], x[3]) for x in lostg if x[3]>=2))[:30])
