from load import *
import math
L = defaultdict(list)
for (c, sid), l in LABELS.items(): L[c].append((sid, investor_gain(l)))
print('casos en etiquetas', Counter(c for c,_ in LABELS))
for p in GOLD:
    c = f'inv-case-syn-{p}'; labs = L[c]; g2 = {sid for sid, g in labs if g >= 2}
    gold = GOLD[p]['stable_id']; gl = lgain(p, gold)
    row = []
    for cond, v in [('B1','A'),('B1','B'),('B2','A'),('B2','B'),('B2E','A')]:
        for r in sorted([r for r in RUNS if r['case']==p and r['cond']==cond and r['variant']==v], key=lambda r: r['seed']):
            ids = {e['stable_id'] for e in r['r']['entities']}
            row.append(f"{cond}{v}s{r['seed']}:{len(ids & g2)}")
    print(p, 'etiquetas', len(labs), 'gain>=2', len(g2), 'gain dist', dict(Counter(g for _, g in labs)), 'oro etiquetado', gl, '|', ' '.join(row))
# cobertura media sobre etiquetas g2 por condición
for cond, v in [('B1','A'),('B1','B'),('B2','A'),('B2','B'),('B2E','A')]:
    cov = []
    for r in [r for r in RUNS if r['cond']==cond and r['variant']==v]:
        g2 = {sid for sid, g in L[f"inv-case-syn-{r['case']}"] if g >= 2}
        ids = {e['stable_id'] for e in r['r']['entities']}
        cov.append(len(ids & g2) / len(g2))
    print(cond, v, 'cobertura media sobre g2 etiquetadas', round(sum(cov)/len(cov),3), 'med', round(med(cov),3), 'n', len(cov))
# varianza entre semillas de g2-etiqueta en B2 (para tamaño de muestra B2E)
sds = []; diffs = []
for v in 'AB':
    for p in GOLD:
        g2 = {sid for sid, g in L[f'inv-case-syn-{p}'] if g >= 2}
        xs = [len({e['stable_id'] for e in r['r']['entities']} & g2) for r in RUNS if r['cond']=='B2' and r['variant']==v and r['case']==p]
        if len(xs) == 3: sds.append(st.pvariance(xs) * 3/2)
print('var media entre semillas (g2 etiqueta por corrida)', round(sum(sds)/len(sds),3), 'sd', round(math.sqrt(sum(sds)/len(sds)),3))
# cobertura del oro: corridas que lo hallan
