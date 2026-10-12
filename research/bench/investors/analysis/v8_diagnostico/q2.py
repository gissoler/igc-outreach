from load import *
out = {}
print('## Q2 precisión por condición y variante')
allun = defaultdict(set)
for cond in ['B1','B2','B2E']:
    for v in 'AB':
        rs = [r for r in RUNS if r['cond']==cond and r['variant']==v]
        if not rs: continue
        acc = lab_n = g2 = sg2 = sg2lab = sg2labok = 0; un = set(); unocc = 0; g = Counter()
        for r in rs:
            sysg = {x['stable_id']: x['gain'] for x in r['r']['ranked']}
            for e in r['r']['entities']:
                acc += 1; lg = lgain(r['case'], e['stable_id'])
                if lg is None: un.add((r['case'], e['stable_id'])); unocc += 1
                else:
                    lab_n += 1; g[lg] += 1; g2 += lg >= 2
                if sysg.get(e['stable_id'], 0) >= 2:
                    sg2 += 1
                    if lg is not None: sg2lab += 1; sg2labok += lg >= 2
        allun[(cond, v)] = un
        print(cond, v, 'corridas', len(rs), 'aceptadas', acc, 'con etiqueta', lab_n, 'sin etiqueta (ocurrencias)', unocc, 'sin etiqueta (únicas)', len(un), 'gain>=2 etiqueta', g2, f'= {g2/lab_n:.3f} de etiquetadas', 'dist', dict(sorted(g.items())), '| sistema g>=2', sg2, 'de ellas etiquetadas', sg2lab, 'etiqueta>=2', sg2labok, f'acuerdo {sg2labok/sg2lab:.3f}' if sg2lab else '')
U = set().union(*allun.values())
print('firmas sin etiqueta únicas (caso,firma) todas condiciones:', len(U))
json.dump(sorted([list(x) for x in U]), open('unlabeled.json','w'), indent=0)
print('\n## estabilidad entre semillas (B2)')
for v in 'AB':
    tot = Counter(); occ = Counter(); g2stab = Counter()
    for p in GOLD:
        sets = [set(e['stable_id'] for e in r['r']['entities']) for r in RUNS if r['cond']=='B2' and r['variant']==v and r['case']==p]
        c = Counter(x for s in sets for x in s)
        for sid, k in c.items():
            tot[k] += 1; occ[k] += k
            lg = lgain(p, sid)
            if lg is not None and lg >= 2: g2stab[k] += 1
    U = sum(tot.values())
    print(v, 'firmas únicas', U, 'en 1/2/3 semillas', [tot[1], tot[2], tot[3]], 'ocurrencias', [occ[1], occ[2], occ[3]], 'sum', sum(occ.values()), 'gain>=2 (etiqueta) por nº semillas', [g2stab[1], g2stab[2], g2stab[3]])
print('\n## por caso y variante, B2: firmas en 3/3 semillas')
for p in GOLD:
    row = []
    for v in 'AB':
        sets = [set(e['stable_id'] for e in r['r']['entities']) for r in RUNS if r['cond']=='B2' and r['variant']==v and r['case']==p]
        c = Counter(x for s in sets for x in s); row.append((v, len(c), sum(1 for k in c.values() if k == 3)))
    print(p, row)
