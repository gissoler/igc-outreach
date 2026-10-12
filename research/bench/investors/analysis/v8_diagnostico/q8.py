from load import *
vals = []
for r in RUNS:
    if r['cond'] not in ('B2','B2E'): continue
    if r['cond']=='B2E': v = r['r']['accepted_after_round_2']
    else:
        # entidades aceptadas antes de la 3.ª llamada del planner: timestamp de planner_start #3
        ps = [e for e in r['ev'] if e['event']=='planner_start']
        if len(ps) >= 3:
            t = ps[2]['timestamp']
            # contar extract_end aceptados antes de t con hosts distintos (aprox) -> usar prefix_curve por búsquedas <= 9
        pc = r['r']['prefix_curve']
        cand = [len(x['stable_ids_so_far']) for x in pc if x['searches'] <= 9]
        v = cand[-1] if cand else 0
        if len(ps) < 3: v = len(r['r']['entities'])  # como sparseAfterRound2: si no hubo 3.ª llamada, total final
    vals.append((r['cond'], r['variant'], r['case'], r['seed'], v))
print(sorted(x[4] for x in vals))
for th in [3,5,8,10,12]:
    hit = [x for x in vals if x[4] < th]
    print('umbral <', th, ':', len(hit), 'de', len(vals), [f"{x[2]}{'-ib' if x[1]=='B' else ''} {x[0]} s{x[3]}={x[4]}" for x in hit][:12])
# relación con resultado final g2 etiqueta
