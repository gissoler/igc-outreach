from load import *
import itertools
def ents(p, v, s): return [r for r in RUNS if r['cond']=='B2' and r['case']==p and r['variant']==v and r['seed']==s][0]
def qtype(q):
    ql = q.lower()
    for k, ws in [('nombre', ['"']), ('cvc', ['corporate venture','corporate-venture','corporate‑venture','cvc','arm of']), ('gobierno/desarrollo', ['government','development bank','development fund','public','sovereign','state-backed','state‑backed']), ('impacto', ['impact']), ('angel/family', ['angel','family office','family‑office','family-office']), ('aceleradora', ['accelerator','incubator']), ('vc', ['venture capital','venture‑capital','venture fund','vc ','seed fund','firm'])]:
        if any(w in ql for w in ws): return k
    return 'otra'
print('par | J dentro A (3) | J dentro B (3) | J entre A-B (9) | n A | n B | g2 etiqueta A | g2 etiqueta B | g2 sistema A | g2 sistema B')
for p in GOLD:
    S = [101,202,303]
    E = {(v,s): set(e['stable_id'] for e in ents(p,v,s)['r']['entities']) for v in 'AB' for s in S}
    jA = [jac(E[('A',a)], E[('A',b)]) for a,b in itertools.combinations(S,2)]
    jB = [jac(E[('B',a)], E[('B',b)]) for a,b in itertools.combinations(S,2)]
    jAB = [jac(E[('A',a)], E[('B',b)]) for a in S for b in S]
    nA = [len(E[('A',s)]) for s in S]; nB = [len(E[('B',s)]) for s in S]
    gA = [sum(1 for x in E[('A',s)] if (lgain(p,x) or 0) >= 2) for s in S]; gB = [sum(1 for x in E[('B',s)] if (lgain(p,x) or 0) >= 2) for s in S]
    sA = [sum(1 for x in ents(p,'A',s)['r']['ranked'] if x['gain']>=2) for s in S]; sB = [sum(1 for x in ents(p,'B',s)['r']['ranked'] if x['gain']>=2) for s in S]
    f = lambda xs: f"{st.median(xs):.2f} ({min(xs):.2f}-{max(xs):.2f})"
    print(p, '|', f(jA), '|', f(jB), '|', f(jAB), '|', nA, '|', nB, '|', gA, '|', gB, '|', sA, '|', sB)
for p in ['p04','p05']:
    print('\n##', p)
    for v in 'AB':
        tys = Counter(); qt = Counter(); nq = 0
        for s in [101,202,303]:
            r = ents(p, v, s)
            for e in r['r']['entities']: tys[e.get('investor_type')] += 1
            for e in r['ev']:
                if e['event']=='planner_end':
                    for q in e.get('queries') or []: qt[qtype(q)] += 1; nq += 1
        print(v, 'investor_type', dict(tys.most_common()), '| tipos de consulta', dict(qt.most_common()), 'n consultas', nq)
    # ejemplos de consulta inicial
    for v in 'AB':
        r = ents(p, v, 101); print(v, [q[:140] for q in [e for e in r['ev'] if e['event']=='planner_end'][0]['queries'][:3]])
# p05 B s101 tuvo 29 firmas; las demás 9
