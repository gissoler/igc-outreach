from load import *
print('runs', len(RUNS), Counter((r['cond'], r['variant']) for r in RUNS))
print('evsrc', Counter((r['evsrc']) for r in RUNS), 'noev', [r['rid'] for r in RUNS if not r['ev']])
for r in RUNS:
    ends = [e for e in r['ev'] if e['event'] == 'run_end']
    if len(ends) != 1: print('ends', r['rid'], len(ends))
B2 = [r for r in RUNS if r['cond'] == 'B2']
for v in 'AB':
    rs = [r for r in B2 if r['variant'] == v]
    acc = sum(len(r['r']['entities']) for r in rs)
    sg2 = sum(sum(1 for x in r['r']['ranked'] if x['gain'] >= 2) for r in rs)
    runs_g2 = sum(1 for r in rs if any(x['gain'] >= 2 for x in r['r']['ranked']))
    gold = sum(1 for r in rs if any(e['stable_id'] == GOLD[r['case']]['stable_id'] for e in r['r']['entities']))
    cases2 = 0
    for p in GOLD:
        k = sum(1 for r in rs if r['case'] == p and any(x['gain'] >= 2 for x in r['r']['ranked']))
        cases2 += k >= 2
    J = []
    for p in GOLD:
        rr = {r['seed']: [e['stable_id'] for e in r['r']['entities']] for r in rs if r['case'] == p}
        for a, b in [(101,202),(101,303),(202,303)]: J.append(jac(rr[a], rr[b]))
    print(v, 'runs', len(rs), 'acc', acc, 'sys_g2', sg2, 'runs_g2', runs_g2, 'cases>=2seeds', cases2, 'gold', gold, 'Jmed', round(med(J), 3))
JAB = []
for p in GOLD:
    for s in [101,202,303]:
        a = [r for r in B2 if r['case']==p and r['seed']==s and r['variant']=='A'][0]; b = [r for r in B2 if r['case']==p and r['seed']==s and r['variant']=='B'][0]
        JAB.append(jac([e['stable_id'] for e in a['r']['entities']], [e['stable_id'] for e in b['r']['entities']]))
print('JAB med', round(med(JAB), 3), sorted(round(x,2) for x in JAB))
for r in RUNS:
    if r['cond']=='B1': print('B1', r['case'], r['variant'], 'gold' if any(e['stable_id']==GOLD[r['case']]['stable_id'] for e in r['r']['entities']) else '')
for r in [r for r in B2 if any(e['stable_id'] == GOLD[r['case']]['stable_id'] for e in r['r']['entities'])]: print('gold found', r['rid'])
