from load import *
files = glob.glob(OUT + '/*/events.jsonl')
G = {p: g['domain'] for p, g in GOLD.items()}
tot = Counter(); hits = defaultdict(list)
for f in files:
    for line in open(f):
        if '"search_end"' not in line: continue
        e = json.loads(line); rid = e.get('run_id', '')
        m = re.search(r'inv-case-syn-(p0[1-6])', rid)
        if not m: continue
        p = m.group(1); tot[(os.path.basename(os.path.dirname(f)), p)] += 1
        for i, u in enumerate(e.get('urls') or []):
            if dom_match(u, G[p]): hits[p].append((os.path.basename(os.path.dirname(f)), rid.split('__',1)[1], i, e['query'][:230], e.get('provider')))
for k, v in sorted(tot.items()): print(k, v)
for p in sorted(G):
    print('\n##', p, G[p], len(hits[p]))
    seen=set()
    for h in hits[p]:
        if h[3] in seen: continue
        seen.add(h[3]); print('  ', h)
