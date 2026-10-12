from load import *
B2 = [r for r in RUNS if r['cond']=='B2']
print(Counter(r['r']['stop_reason'] for r in B2))
for sr in sorted(set(r['r']['stop_reason'] for r in B2)):
    rs = [r for r in B2 if r['r']['stop_reason']==sr]
    n = [len(r['r']['entities']) for r in rs]; s = [r['r']['totals']['searches'] for r in rs]; f = [r['r']['totals']['fetches'] for r in rs]
    print(sr, len(rs), 'firmas med', med(n), 'rango', min(n), max(n), 'búsquedas med', med(s), max(s), 'fetches med', med(f), max(f), 'planner med', med([r['r']['totals']['planner_calls'] for r in rs]), 'tokens med', med([r['r']['totals']['tokens_nominal'] for r in rs]))
print('budgets: searches 18, fetches 54, planner 8, tokens 300000')
print('max totals', max(r['r']['totals']['searches'] for r in B2), max(r['r']['totals']['fetches'] for r in B2), max(r['r']['totals']['planner_calls'] for r in B2), max(r['r']['totals']['tokens_nominal'] for r in B2))
# prefix curve
pc = B2[0]['r']['prefix_curve']; print('prefix sample', [(x['search_index'], x['searches'], x['fetches'], len(x['stable_ids_so_far'])) for x in pc])
tail = []; first = []; lastk = []
for r in B2:
    pc = r['r']['prefix_curve']
    ys = [len(x['stable_ids_so_far']) for x in pc]
    final = len(r['r']['entities'])
    n = len(ys)
    if n < 4: continue
    k = max(1, n // 3)
    gfirst = (ys[k-1]) / k; gl = (ys[-1] - ys[-k-1]) / k
    first.append(gfirst); tail.append(gl)
    lastk.append((r['rid'][-22:], n, ys, final, r['r']['stop_reason']))
print('firmas nuevas por búsqueda: primer tercio med', round(med(first),2), 'último tercio med', round(med(tail),2))
print('corridas con 0 firmas nuevas en el último tercio', sum(1 for x in tail if x == 0), 'de', len(tail))
for x in lastk[:40]: print(x)
# deepening adds?
