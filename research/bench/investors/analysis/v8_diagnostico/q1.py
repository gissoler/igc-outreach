from load import *
SLUG = {'p01':['magma'],'p02':['lightrock'],'p03':['celesta'],'p04':['golden.ventures','golden-ventures','goldenventures'],'p05':['worldfund','world-fund','world fund'],'p06':['ecapital']}
rows = []
for r in RUNS:
    g = GOLD[r['case']]; d = g['domain']; ev = r['ev']
    opened_q = {e['query'] for e in ev if e['event']=='search_opened'}
    se = [e for e in ev if e['event']=='search_end']
    hit_main = [(e['query'], u) for e in se if e['query'] in opened_q for u in e.get('urls') or [] if dom_match(u, d)]
    hit_any = [(e['query'], u) for e in se for u in e.get('urls') or [] if dom_match(u, d)]
    slug = [(e['query'], u) for e in se for u in e.get('urls') or [] if any(s in u.lower() for s in SLUG[r['case']]) and not dom_match(u, d)]
    tri = [x for e in se for x in ((e.get('triage') or {}).get('discarded') or []) if dom_match(x['url'], d)]
    rf = [e for e in ev if e['event']=='relevance_filter']
    rf_in = [(e['urls'][i], i in e['kept']) for e in rf for i in range(len(e['urls'])) if dom_match(e['urls'][i], d)]
    fs = [e for e in ev if e['event']=='fetch_start' and dom_match(e['url'], d)]
    fe = [e for e in ev if e['event']=='fetch_end' and dom_match(e['url'], d)]
    ex = [e for e in ev if e['event']=='extract_end' and dom_match(e['url'], d)]
    exn = [e for e in ev if e['event']=='extract_end' and any(s in (e.get('canonical_name') or '').lower() for s in [g['name'].split()[0].lower()])]
    res = [e for e in ev if e['event'].startswith('resolution_end') and g['name'].split()[0].lower() in (e.get('name') or '').lower()]
    ent = any(e['stable_id']==g['stable_id'] for e in r['r']['entities'])
    if ent: stage='aceptado'
    elif ex: stage='extraído-no-aceptado'
    elif fe: stage='fetch-sin-extracción'
    elif fs: stage='abierto'
    elif hit_any: stage='devuelto-no-abierto'
    else: stage='no-devuelto'
    rows.append(dict(rid=r['rid'], case=r['case'], v=r['variant'], cond=r['cond'], seed=r['seed'], stage=stage, n_main=len(hit_main), n_any=len(hit_any), slug=len(slug), tri=len(tri), rf=rf_in, fetch=[(e['ok'], e.get('error_code'), e.get('text_chars')) for e in fe], extract=[(e['accepted'], e.get('rejected_kind'), e.get('kind'), e.get('canonical_name')) for e in ex], exn=[(e['url'], e['accepted'], e.get('canonical_name')) for e in exn][:3], res=[(e['name'], e['outcome'], e.get('url')) for e in res], hits=hit_any[:3], slugs=slug[:3], searches=len(se)))
for x in rows: print(x['case'], x['v'], x['cond'], x['seed'], x['stage'], 'main', x['n_main'], 'any', x['n_any'], 'slug', x['slug'], 'tri', x['tri'], x['rf'], x['fetch'], x['extract'], x['exn'], x['res'])
print()
for x in rows:
    if x['hits'] or x['slugs']: print(x['rid'][-25:], x['hits'], x['slugs'])
print(Counter((x['case'], x['stage']) for x in rows))
json.dump(rows, open('q1.json','w'), ensure_ascii=False, indent=1)
