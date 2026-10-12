from load import *
for cond in ['B2','B2E','B1']:
    rs = [r for r in RUNS if r['cond']==cond]
    fe = [e for r in rs for e in r['ev'] if e['event']=='fetch_end']
    ex = [e for r in rs for e in r['ev'] if e['event']=='extract_end']
    print('##', cond, 'corridas', len(rs), 'fetch_end', len(fe), 'ok', sum(e['ok'] for e in fe), 'cached', sum(bool(e.get('cached')) for e in fe))
    print(' via', Counter(e.get('via') for e in fe).most_common())
    print(' error_code', Counter(e.get('error_code') for e in fe if not e['ok']).most_common())
    print(' ok con <200 chars', sum(1 for e in fe if e['ok'] and (e.get('text_chars') or 0) < 200))
    print(' fallback', sum(1 for r in rs for e in r['ev'] if e['event']=='fetch_fallback'), Counter(e.get('via') for r in rs for e in r['ev'] if e['event']=='fetch_fallback'))
    print(' extract_end', len(ex), 'accepted', sum(e['accepted'] for e in ex), 'rejected_kind', Counter(e.get('rejected_kind') for e in ex if not e['accepted']).most_common(), 'kind of rejected', Counter(e.get('kind') for e in ex if not e['accepted']).most_common())
    print(' totals.rejected_non_investors', sum(r['r']['totals']['rejected_non_investors'] for r in rs), 'portfolio_rejected', sum(r['r']['totals']['portfolio_companies_rejected'] for r in rs), 'totals.fetches', sum(r['r']['totals']['fetches'] for r in rs))
    v2 = Counter()
    for r in rs:
        s = r['r'].get('v2_stats') or {}
        for k in ['fetch_empty','denied_urls','deduped_urls','skipped_empty_hosts','fetch_fallback_search_contents','reads','candidates_seen','candidates_pending','sector_llm_calls']:
            v2[k] += s.get(k) or 0 if not isinstance(s.get(k), list) else len(s.get(k))
        for k, v in (s.get('rejected_by_kind') or {}).items(): v2['rbk_'+k] += v
        tr = s.get('triage') or {}
        for k in ['discarded','demoted_opened','demoted_skipped']: v2['tri_'+k] += tr.get(k) or 0
        d = s.get('deepening') or {}
        for k in ['searches','fetches','fetch_empty','firms','extract_calls']: v2['deep_'+k] += d.get(k) or 0
    print(' v2_stats', dict(v2))
    # dominios que fallan repetidamente
    bad = Counter(host(e['url']) for e in fe if not e['ok'])
    print(' dominios con >=3 fallos', [(d, n) for d, n in bad.most_common() if n >= 3])
    badruns = defaultdict(set)
    for r in rs:
        for e in r['ev']:
            if e['event']=='fetch_end' and not e['ok']: badruns[host(e['url'])].add(r['rid'])
    print(' dominios que fallan en >=3 corridas', sorted([(d, len(v)) for d, v in badruns.items() if len(v) >= 3], key=lambda x: -x[1])[:25])
    # rechazados por tipo de pagina (url patterns)
    rej = [e for e in ex if not e['accepted']]
    pat = Counter()
    for e in rej:
        u = e['url'].lower()
        k = 'portfolio' if 'portfolio' in u or '/companies' in u else 'news/blog' if any(s in u for s in ['/news','/blog','/press','/post','/article','/20']) else 'linkedin' if 'linkedin' in u else 'pdf' if u.endswith('.pdf') else 'otro'
        pat[k] += 1
    print(' rechazados por patrón URL', pat.most_common())
    # search providers / errores
    se = [e for r in rs for e in r['ev'] if e['event']=='search_end']
    print(' search_end', len(se), 'provider', Counter(e.get('provider') for e in se).most_common(), 'con error', sum(1 for e in se if e.get('error')), 'attempt errors', Counter((a['provider'], (a.get('error') or '')[:40]) for e in se for a in e.get('attempts') or [] if a.get('error')).most_common(), 'resultados 0', sum(1 for e in se if not e.get('results')))
    exa_paid = sum(1 for e in se for a in e.get('attempts') or [] if a['provider']=='exa' and not a.get('cached'))
    print(' exa no cacheadas', exa_paid)
