from load import *
def main_searches(r):
    op = {e['query']: e for e in r['ev'] if e['event']=='search_opened'}
    return [e for e in r['ev'] if e['event']=='search_end' and e['query'] in op], op
def planner_q(r):
    pe = [e for e in r['ev'] if e['event']=='planner_end']
    return pe
rows = []
agg = defaultdict(list)
for v in 'AB':
    for p in GOLD:
        rs = {r['seed']: r for r in RUNS if r['cond']=='B2' and r['variant']==v and r['case']==p}
        info = {}
        for s, r in rs.items():
            pe = planner_q(r)
            init = pe[0]['queries'] if pe else []
            allq = [q for e in pe for q in (e.get('queries') or [])]
            ms, op = main_searches(r)
            urls = set(u for e in ms for u in e.get('urls') or [])
            doms = set(host(u) for u in urls)
            opened = set(op[q]['urls'][i] for q in op for i in op[q].get('opened') or [] if i < len(op[q]['urls']))
            fetched = set(e['url'] for e in r['ev'] if e['event']=='fetch_start')
            ents = set(e['stable_id'] for e in r['r']['entities'])
            info[s] = dict(init=init, allq=set(allq), urls=urls, doms=doms, opened=opened, odoms=set(host(u) for u in opened), ents=ents, fdoms=set(host(u) for u in fetched))
        for a, b in [(101,202),(101,303),(202,303)]:
            A, Bb = info[a], info[b]
            same_init = len(set(A['init']) & set(Bb['init']))
            # decomposición de firmas en A no en B
            miss = A['ents'] - Bb['ents']
            dom_of = lambda sid: sid.split('inv:domain:')[1] if sid.startswith('inv:domain:') else None
            inret = sum(1 for sid in miss if dom_of(sid) and any(d == dom_of(sid) or d.endswith('.'+dom_of(sid)) for d in Bb['doms']))
            inopen = sum(1 for sid in miss if dom_of(sid) and any(d == dom_of(sid) or d.endswith('.'+dom_of(sid)) for d in Bb['fdoms']))
            nodom = sum(1 for sid in miss if not dom_of(sid))
            row = dict(v=v, p=p, pair=(a,b), init_n=(len(A['init']), len(Bb['init'])), init_same=same_init, q_same=len(A['allq'] & Bb['allq']), q_n=(len(A['allq']), len(Bb['allq'])), J_urls=round(jac(A['urls'], Bb['urls']),3), J_doms=round(jac(A['doms'], Bb['doms']),3), J_opened=round(jac(A['opened'], Bb['opened']),3), J_ents=round(jac(A['ents'], Bb['ents']),3), miss=len(miss), miss_dom_returned_in_other=inret, miss_dom_fetched_in_other=inopen, miss_nodomain=nodom)
            rows.append(row)
            for k in ['J_urls','J_doms','J_opened','J_ents']: agg[(v,k)].append(row[k])
            agg[(v,'init_same')].append(same_init); agg[(v,'q_same')].append(row['q_same']); agg[(v,'miss')].append(len(miss)); agg[(v,'ret')].append(inret); agg[(v,'fet')].append(inopen)
for r in rows: print(r)
for v in 'AB':
    print(v, {k: (round(med(agg[(v,k)]),3), round(sum(agg[(v,k)])/len(agg[(v,k)]),3)) for k in ['J_urls','J_doms','J_opened','J_ents','init_same','q_same']}, 'miss', sum(agg[(v,'miss')]), 'devueltas en la otra', sum(agg[(v,'ret')]), 'abiertas en la otra', sum(agg[(v,'fet')]))
# ejemplo de consultas iniciales
r1 = [r for r in RUNS if r['cond']=='B2' and r['variant']=='A' and r['case']=='p03']
for r in sorted(r1, key=lambda r: r['seed']):
    print(r['seed'], [q[:110] for q in [e for e in r['ev'] if e['event']=='planner_end'][0]['queries'][:3]])
# caché de exa: llamadas repetidas
c = Counter(); 
for r in RUNS:
    for e in r['ev']:
        if e['event']=='search_end':
            for a in e.get('attempts') or []:
                if a['provider']=='exa': c['cached' if a.get('cached') else 'paid'] += 1
print('exa attempts in the 51 runs', c)
# variabilidad del extractor: misma URL, distinto resultado entre corridas (mismo text_chars)
ex = defaultdict(set)
for r in RUNS:
    fe = {e['url']: e.get('text_chars') for e in r['ev'] if e['event']=='fetch_end'}
    for e in r['ev']:
        if e['event']=='extract_end': ex[(e['url'], fe.get(e['url']))].add((e['accepted'], e.get('rejected_kind'), e.get('kind')))
multi = {k: v for k, v in ex.items() if len(v) > 1}
print('URL+chars extraídas en >1 corrida con resultados distintos:', len(multi), 'de', len(ex), list(multi.items())[:5])
