"""SEC Form D — Data Sets trimestrales + derivación de fondos VC, partners y comparables.

Fuente: https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets
Diccionario de campos: https://www.sec.gov/files/Form_D.pdf

Qué obtenemos (y qué NO):
  (a) Fondos VC que levantan fondo  -> universo de inversores activos + tamaño + GPs (related persons)
  (b) Form D de los comparables      -> montos/fechas de rondas + directors (a menudo partners del VC líder)
  Form D NO lista inversores. El vínculo fondo→comparable por board seat se marca como INFERIDO.

Los TSV del zip se cargan tal cual a tablas crudas y luego se mapean a dos tablas
normalizadas propias (fd_filing, fd_person) que también alimenta edgar.py.
Los nombres de columna se resuelven de forma tolerante porque la SEC los ha
cambiado entre versiones; `warmpath formd-columns` imprime lo que trae el zip.
"""
from __future__ import annotations

import io
import zipfile
from datetime import date
from pathlib import Path

from ..db import Store
from ..models import Config
from ..normalize import norm_org, norm_text, org_id, person_id

INDEX_URL = "https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets"
# La SEC ha usado varios prefijos de carpeta para este mismo dataset (p.ej. cambiaron
# "structureddata" por "datastandardsinnovation" para el trimestre más reciente en 2026).
# Por eso NO se asume un prefijo fijo: se resuelve el href real desde la página índice,
# y solo si eso falla se prueban estos prefijos conocidos como respaldo.
KNOWN_PREFIXES = ["datastandardsinnovation", "structureddata"]

FD_SCHEMA = """
CREATE TABLE IF NOT EXISTS fd_filing(
    accession VARCHAR, cik VARCHAR, entity_name VARCHAR, norm_org VARCHAR, city VARCHAR, state VARCHAR,
    filing_date DATE, industry_group VARCHAR, fund_type VARCHAR, total_offering DOUBLE, total_sold DOUBLE,
    sale_date DATE, is_amendment BOOLEAN, origin VARCHAR
);
CREATE TABLE IF NOT EXISTS fd_person(
    accession VARCHAR, first_name VARCHAR, last_name VARCHAR, norm_name VARCHAR, city VARCHAR, state VARCHAR,
    relationships VARCHAR, clarification VARCHAR
);
"""

TABLES = ["FORMDSUBMISSION", "ISSUERS", "OFFERING", "RELATEDPERSONS"]


def ensure_schema(store: Store) -> None:
    store.con.execute(FD_SCHEMA)


def resolve_quarter_url(quarter: str, client=None) -> str:
    """Busca en la página índice el href real del zip de ese trimestre (robusto a que la
    SEC cambie de carpeta). Si no lo encuentra ahí, prueba los prefijos conocidos."""
    import re

    from selectolax.parser import HTMLParser

    from ..http import sec_client

    c = client or sec_client()
    q = quarter.lower()
    try:
        r = c.get(INDEX_URL)
        if r.status_code == 200:
            pat = re.compile(rf"/{q}_d(_\d+)?\.zip$", re.I)
            for a in HTMLParser(r.text).css("a[href]"):
                href = a.attributes.get("href") or ""
                if pat.search(href):
                    return href if href.startswith("http") else f"https://www.sec.gov{href}"
    except Exception:
        pass  # sin red a la página índice: se cae a los prefijos conocidos
    for prefix in KNOWN_PREFIXES:
        url = f"https://www.sec.gov/files/{prefix}/data/form-d-data-sets/{q}_d.zip"
        try:
            if c.client.head(url, headers={"User-Agent": c.ua}, follow_redirects=True).status_code == 200:
                return url
        except Exception:
            continue
    raise FileNotFoundError(
        f"No encontré el zip de {quarter} ni en la página índice ({INDEX_URL}) ni en los prefijos "
        f"conocidos {KNOWN_PREFIXES}. Puede que la SEC haya cambiado de nuevo la ruta: revisa "
        f"{INDEX_URL} a mano.")


def download_quarter(quarter: str, dest_dir: str | Path = "data/raw/formd") -> Path:
    """quarter = '2026q2'. Descarga el zip (≈decenas de MB) con User-Agent SEC."""
    from ..http import sec_client

    dest = Path(dest_dir) / f"{quarter.lower()}_d.zip"
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    client = sec_client()
    url = resolve_quarter_url(quarter, client)
    r = client.get(url)
    r.raise_for_status()
    dest.write_bytes(r.content)
    return dest


def _cols(store: Store, table: str) -> dict[str, str]:
    return {r[0].upper(): r[0] for r in store.q(
        "SELECT column_name FROM information_schema.columns WHERE table_name=?", [table])}


def _pick(cols: dict[str, str], *cands: str, required: bool = False) -> str:
    for c in cands:
        if c.upper() in cols:
            return f'"{cols[c.upper()]}"'
    if required:
        raise KeyError(f"Ninguna de las columnas {cands} existe. Columnas: {sorted(cols)[:40]}")
    return "NULL"


def _date(expr: str) -> str:
    if expr == "NULL":
        return "NULL"
    return (f"COALESCE(try_strptime({expr}, '%d-%b-%Y'), try_strptime({expr}, '%Y-%m-%d'),"
            f" try_strptime({expr}, '%m/%d/%Y'))::DATE")


def _num(expr: str) -> str:
    return "NULL" if expr == "NULL" else f"try_cast(regexp_replace({expr}, '[^0-9.]', '', 'g') AS DOUBLE)"


def list_zip_columns(zip_path: str | Path) -> dict[str, list[str]]:
    out = {}
    with zipfile.ZipFile(zip_path) as z:
        for n in z.namelist():
            if n.lower().endswith(".tsv"):
                with z.open(n) as f:
                    out[n] = io.TextIOWrapper(f, encoding="latin-1").readline().strip().split("\t")
    return out


def load_zip(store: Store, zip_path: str | Path) -> dict[str, int]:
    """Carga un zip trimestral a fd_filing / fd_person. Idempotente por accession."""
    ensure_schema(store)
    zip_path = Path(zip_path)
    tmp = zip_path.parent / (zip_path.stem + "_x")
    tmp.mkdir(exist_ok=True)
    found: dict[str, Path] = {}
    with zipfile.ZipFile(zip_path) as z:
        for n in z.namelist():
            stem = Path(n).stem.upper()
            if stem in TABLES and n.lower().endswith(".tsv"):
                p = tmp / f"{stem}.tsv"
                p.write_bytes(z.read(n))
                found[stem] = p
    missing = set(TABLES) - set(found)
    if missing:
        raise FileNotFoundError(f"Faltan TSV en el zip: {missing}")

    for t, p in found.items():
        store.con.execute(f"DROP TABLE IF EXISTS raw_{t.lower()}")
        store.con.execute(
            f"CREATE TABLE raw_{t.lower()} AS SELECT * FROM read_csv(?, delim='\t', header=true, "
            f"all_varchar=true, quote='', escape='', ignore_errors=true, encoding='latin-1', strict_mode=false)",
            [str(p)],
        )

    s, i, o, r = (_cols(store, f"raw_{t.lower()}") for t in TABLES)
    acc = "ACCESSIONNUMBER"
    primary = _pick(i, "IS_PRIMARYISSUER_FLAG")
    # prefijar alias en expresiones de columna
    def P(alias: str, expr: str) -> str:
        return expr if expr == "NULL" else f"{alias}.{expr}"

    n_before = store.q("SELECT count(*) FROM fd_filing")[0][0]
    ia, sa, oa = (_pick(x, acc, required=True) for x in (i, s, o))
    where = [f"i.{ia} NOT IN (SELECT accession FROM fd_filing)"]
    if primary != "NULL":
        where.append(f"upper(coalesce(i.{primary}, 'YES')) IN ('YES','Y','TRUE','1')")
    store.con.execute(f"""
        INSERT INTO fd_filing
        SELECT i.{ia}, ltrim(i.{_pick(i, 'CIK', required=True)}, '0'),
               i.{_pick(i, 'ENTITYNAME', required=True)}, NULL,
               {P('i', _pick(i, 'CITY'))}, {P('i', _pick(i, 'STATEORCOUNTRY'))},
               {_date(P('s', _pick(s, 'FILING_DATE', 'FILINGDATE')))},
               {P('o', _pick(o, 'INDUSTRYGROUPTYPE'))}, {P('o', _pick(o, 'INVESTMENTFUNDTYPE'))},
               {_num(P('o', _pick(o, 'TOTALOFFERINGAMOUNT')))}, {_num(P('o', _pick(o, 'TOTALAMOUNTSOLD')))},
               {_date(P('o', _pick(o, 'SALE_DATE', 'DATEOFFIRSTSALE')))},
               upper(coalesce({P('o', _pick(o, 'ISAMENDMENT'))}, 'false')) IN ('TRUE','YES','Y','1'),
               ?
        FROM raw_issuers i
        LEFT JOIN raw_formdsubmission s ON s.{sa} = i.{ia}
        LEFT JOIN raw_offering o ON o.{oa} = i.{ia}
        WHERE {' AND '.join(where)}
    """, [f"bulk:{zip_path.name}"])

    rel_cols = [c for c in ("RELATIONSHIP_1", "RELATIONSHIP_2", "RELATIONSHIP_3") if c in r]
    rel_expr = "concat_ws('|', " + ", ".join(f'r."{r[c]}"' for c in rel_cols) + ")" if rel_cols else "NULL"
    store.con.execute(f"""
        INSERT INTO fd_person
        SELECT r.{_pick(r, acc, required=True)}, r.{_pick(r, 'FIRSTNAME', required=True)},
               r.{_pick(r, 'LASTNAME', required=True)}, NULL,
               {P('r', _pick(r, 'CITY'))}, {P('r', _pick(r, 'STATEORCOUNTRY'))},
               {rel_expr}, {P('r', _pick(r, 'RELATIONSHIPCLARIFICATION'))}
        FROM raw_relatedpersons r
        WHERE r.{_pick(r, acc)} NOT IN (SELECT DISTINCT accession FROM fd_person)
    """)
    _fill_norms(store)
    for t in TABLES:
        store.con.execute(f"DROP TABLE IF EXISTS raw_{t.lower()}")
    n_after = store.q("SELECT count(*) FROM fd_filing")[0][0]
    return {"filings_added": n_after - n_before}


def _fill_norms(store: Store) -> None:
    """Normaliza nombres con las funciones Python (sin UDFs: no exige numpy)."""
    con = store.con
    names = [r[0] for r in con.execute(
        "SELECT DISTINCT entity_name FROM fd_filing WHERE norm_org IS NULL AND entity_name IS NOT NULL").fetchall()]
    if names:
        con.execute("CREATE OR REPLACE TEMP TABLE _n_org(k VARCHAR, v VARCHAR)")
        con.executemany("INSERT INTO _n_org VALUES (?,?)", [(n, norm_org(n)) for n in names])
        con.execute("UPDATE fd_filing SET norm_org = _n_org.v FROM _n_org WHERE fd_filing.entity_name = _n_org.k "
                    "AND fd_filing.norm_org IS NULL")
    con.execute("UPDATE fd_filing SET norm_org = '' WHERE norm_org IS NULL")
    pairs = con.execute("SELECT DISTINCT coalesce(first_name,''), coalesce(last_name,'') FROM fd_person "
                        "WHERE norm_name IS NULL").fetchall()
    if pairs:
        con.execute("CREATE OR REPLACE TEMP TABLE _n_p(f VARCHAR, l VARCHAR, v VARCHAR)")
        con.executemany("INSERT INTO _n_p VALUES (?,?,?)", [(f, l, norm_text(f"{f} {l}")) for f, l in pairs])
        con.execute("UPDATE fd_person SET norm_name = _n_p.v FROM _n_p WHERE coalesce(fd_person.first_name,'') = _n_p.f "
                    "AND coalesce(fd_person.last_name,'') = _n_p.l AND fd_person.norm_name IS NULL")


# --------------------------------------------------------------------------- derivación
def derive_entities(store: Store, cfg: Config, *, since: date | None = None) -> dict[str, int]:
    """Convierte fd_filing/fd_person en entidades y aristas con procedencia.

    - Fondos VC (Pooled Investment Fund + Venture Capital Fund) -> kind=fund, agrupados por
      nombre normalizado (Fund I, II, III -> una firma). fund_profile.fund_size / last_activity.
    - Related persons de esos fondos -> persona + partner_of (s=0.9).
    - Comparables (por CIK o nombre) -> startup + director_of; co_director entre sus directores.
    - Director de un comparable que también es related person de un fondo VC -> invested_in INFERIDO.
    """
    ensure_schema(store)
    stats = {"funds": 0, "partners": 0, "comparable_filings": 0, "inferred_investments": 0, "co_director": 0}
    since_sql = "AND coalesce(filing_date, sale_date) >= ?" if since else ""
    params = [since] if since else []

    funds = store.qd(f"""
        SELECT norm_org, any_value(entity_name) AS name, list(DISTINCT cik) AS ciks,
               max(coalesce(filing_date, sale_date)) AS last_date,
               max(coalesce(total_offering, total_sold)) AS size,
               list(DISTINCT accession) AS accs, any_value(city) AS city, any_value(state) AS state
        FROM fd_filing
        WHERE industry_group ILIKE '%pooled investment%' AND fund_type ILIKE '%venture%'
          AND norm_org <> '' {since_sql}
        GROUP BY norm_org
    """, params)
    for f in funds:
        acc0 = f["accs"][0]
        pid = store.add_prov("sec_formd", _edgar_url(f["ciks"][0], acc0),
                             f"Form D {acc0}: {f['name']} — Venture Capital Fund, oferta {f['size']}", 1.0)
        fid = org_id(f["name"], kind="fund")
        store.upsert_entity(fid, "fund", _clean_fund_name(f["name"]), prov_id=pid, cik=",".join(f["ciks"]),
                            city=f["city"], country=_country(f["state"]),
                            attrs={"formd_accessions": f["accs"][:20], "vehicle_names": [f["name"]]})
        _upsert_fund_profile(store, fid, size=f["size"], last=f["last_date"], pid=pid,
                             src=f"Form D {acc0} (TotalOfferingAmount)")
        stats["funds"] += 1
        persons = store.qd(f"""
            SELECT DISTINCT first_name, last_name, norm_name, city, state, relationships, clarification, accession
            FROM fd_person WHERE accession IN ({",".join("?" * len(f["accs"]))})
        """, f["accs"])
        for p in persons:
            if not p["norm_name"] or _looks_like_entity(p):
                continue
            name = f"{(p['first_name'] or '').title()} {(p['last_name'] or '').title()}".strip()
            pers = person_id(name=name, org=f["name"])
            store.upsert_entity(pers, "person", name, prov_id=pid, org_name=_clean_fund_name(f["name"]),
                                title=(p["relationships"] or "").replace("|", ", "), city=p["city"],
                                attrs={"formd_names": [p["norm_name"]]})
            store.add_edge(pers, fid, "partner_of", strength=0.9, prov_id=pid,
                           evidence=f"Related person ({p['relationships']}) en Form D {p['accession']} de {f['name']}",
                           start_date=f["last_date"])
            stats["partners"] += 1

    # ----- comparables
    fund_person_names = {r[0]: r[1] for r in store.q("""
        SELECT json_extract_string(e.attrs, '$.formd_names[0]') AS nn, ed.dst
        FROM entities e JOIN edges ed ON ed.src = e.entity_id AND ed.rel = 'partner_of'
        WHERE e.kind='person' AND json_extract_string(e.attrs, '$.formd_names[0]') IS NOT NULL""")}
    for comp in cfg.comparables:
        names = {norm_org(comp.name), *[norm_org(a) for a in comp.aliases]} - {""}
        where = ["norm_org IN (" + ",".join("?" * len(names)) + ")"]
        params2: list = list(names)
        if comp.sec_cik:
            where.append("cik = ?")
            params2.append(comp.sec_cik.lstrip("0"))
        rows = store.qd(f"SELECT * FROM fd_filing WHERE ({' OR '.join(where)}) ORDER BY filing_date", params2)
        sid = org_id(comp.name, kind="startup")
        for row in rows:
            pid = store.add_prov("sec_formd", _edgar_url(row["cik"], row["accession"]),
                                 f"Form D {row['accession']}: {row['entity_name']} vendió {row['total_sold']} "
                                 f"(oferta {row['total_offering']}), primera venta {row['sale_date']}", 1.0)
            store.upsert_entity(sid, "startup", comp.name, prov_id=pid, cik=row["cik"], domain=comp.domain,
                                attrs={"comparable": True})
            stats["comparable_filings"] += 1
            directors = store.qd("SELECT * FROM fd_person WHERE accession=?", [row["accession"]])
            ids = []
            for d in directors:
                if not d["norm_name"] or _looks_like_entity(d):
                    continue
                name = f"{(d['first_name'] or '').title()} {(d['last_name'] or '').title()}".strip()
                fund_hit = fund_person_names.get(d["norm_name"])
                org = store.q("SELECT name FROM entities WHERE entity_id=?", [fund_hit])[0][0] if fund_hit else comp.name
                pers = person_id(name=name, org=org)
                store.upsert_entity(pers, "person", name, prov_id=pid, org_name=org,
                                    attrs={"formd_names": [d["norm_name"]]})
                store.add_edge(pers, sid, "director_of", strength=0.6, prov_id=pid, start_date=row["filing_date"],
                               evidence=f"{d['relationships']} de {comp.name} en Form D {row['accession']}")
                ids.append(pers)
                is_director_only = "director" in (d["relationships"] or "").lower() and \
                    "executive" not in (d["relationships"] or "").lower()
                if fund_hit and is_director_only:
                    store.add_edge(fund_hit, sid, "invested_in", prov_id=pid, start_date=row["sale_date"] or row["filing_date"],
                                   evidence=f"INFERIDO: {name} es director de {comp.name} (Form D {row['accession']}) "
                                            f"y related person de un fondo VC — board seat típico del lead",
                                   attrs={"inferred": "formd_board", "confidence": 0.6})
                    stats["inferred_investments"] += 1
            for a in range(len(ids)):
                for b in range(a + 1, len(ids)):
                    store.add_edge(ids[a], ids[b], "co_director", strength=0.35, prov_id=pid,
                                   start_date=row["filing_date"],
                                   evidence=f"Co-listados en Form D {row['accession']} de {comp.name}")
                    stats["co_director"] += 1
    return stats


def link_people_to_formd(store: Store, person_ids: list[str] | None = None) -> int:
    """Segundo salto público: si un contacto (p.ej. 1er grado del founder) aparece como related
    person en el MISMO Form D que un partner de fondo, se crea co_director.

    Coincidencia por nombre normalizado + empresa normalizada del emisor == empresa del contacto,
    para evitar homónimos. Devuelve nº de aristas creadas.
    """
    ensure_schema(store)
    people = store.qd("SELECT entity_id, name, norm_name, org_name FROM entities WHERE kind='person'"
                      + (" AND entity_id IN (" + ",".join("?" * len(person_ids)) + ")" if person_ids else ""),
                      person_ids or [])
    partners = {r["nn"]: r["entity_id"] for r in store.qd("""
        SELECT e.entity_id, json_extract_string(e.attrs,'$.formd_names[0]') nn FROM entities e
        JOIN edges ed ON ed.src=e.entity_id AND ed.rel='partner_of'""") if r["nn"]}
    n = 0
    for p in people:
        if not p["norm_name"] or not p["org_name"] or p["entity_id"] in partners.values():
            continue
        accs = store.qd("""
            SELECT fp.accession, f.entity_name, f.filing_date FROM fd_person fp JOIN fd_filing f USING(accession)
            WHERE fp.norm_name = ? AND f.norm_org = ?""", [p["norm_name"], norm_org(p["org_name"])])
        for a in accs:
            co = store.q("SELECT DISTINCT norm_name FROM fd_person WHERE accession=? AND norm_name<>?",
                         [a["accession"], p["norm_name"]])
            for (nn,) in co:
                if nn in partners:
                    pid = store.add_prov("sec_formd", None, f"Form D {a['accession']} ({a['entity_name']})", 0.8)
                    store.add_edge(p["entity_id"], partners[nn], "co_director", strength=0.35, prov_id=pid,
                                   start_date=a["filing_date"],
                                   evidence=f"Co-listados en Form D {a['accession']} de {a['entity_name']}")
                    n += 1
    return n


# --------------------------------------------------------------------------- utils
def _upsert_fund_profile(store: Store, fid: str, *, size, last, pid, src) -> None:
    ex = store.q("SELECT fund_size, last_activity FROM fund_profile WHERE entity_id=?", [fid])
    if not ex:
        store.con.execute("INSERT INTO fund_profile(entity_id, fund_size, fund_size_src, last_activity, prov_id) "
                          "VALUES (?,?,?,?,?)", [fid, size, src, last, pid])
    else:
        store.con.execute("""UPDATE fund_profile SET
                             fund_size_src = CASE WHEN coalesce(?,0) > coalesce(fund_size,0) THEN ? ELSE fund_size_src END,
                             fund_size = greatest(coalesce(fund_size,0), coalesce(?,0)),
                             last_activity = greatest(coalesce(last_activity, DATE '1900-01-01'), coalesce(?, DATE '1900-01-01'))
                             WHERE entity_id=?""", [size, src, size, last, fid])


def _looks_like_entity(p: dict) -> bool:
    """Related persons a veces son el GP (una LLC), no una persona."""
    full = f"{p.get('first_name') or ''} {p.get('last_name') or ''}".lower()
    return any(t in full.split() for t in ("llc", "lp", "l.p.", "inc", "ltd", "gp", "management", "partners", "capital"))


def _clean_fund_name(name: str) -> str:
    n = norm_org(name)
    return n.title() if n else name


def _country(state: str | None) -> str:
    if not state:
        return ""
    return "US" if len(state) == 2 and state.isalpha() and state.isupper() else state


def _edgar_url(cik: str | None, accession: str | None) -> str | None:
    if not cik or not accession:
        return None
    return f"https://www.sec.gov/Archives/edgar/data/{str(cik).lstrip('0')}/{accession.replace('-', '')}/"
