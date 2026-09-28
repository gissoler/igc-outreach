"""CLI `warmpath` (Typer). Orden típico:

  warmpath init
  warmpath formd-download 2026q2 && warmpath formd-load data/raw/formd/2026q2_d.zip
  warmpath rounds config/rounds.yaml
  warmpath formd-derive --since 2024-01-01
  warmpath linkedin exports/linkedin/
  warmpath outlook exports/outlook/
  warmpath enrich-funds --limit 40          (opcional, requiere ANTHROPIC_API_KEY para tesis/ticket)
  warmpath run                              (resolve + vínculos públicos + ranking + reporte)
"""
from __future__ import annotations

import json
import shutil
from datetime import date, datetime
from pathlib import Path

import typer
import yaml

from .db import OUTCOME_STAGES, Store
from .models import Config, Person

app = typer.Typer(add_completion=False, help="Warm Path Engine — MVP")
consent_app = typer.Typer(help="Consentimientos para pooling de redes entre founders")
review_app = typer.Typer(help="Cola de revisión humana de resolución de entidades")
app.add_typer(consent_app, name="consent")
app.add_typer(review_app, name="review")

STATE = {"db": "data/warmpath.duckdb", "config": "config/project.yaml"}
ROOT = Path(__file__).resolve().parents[2]


@app.callback()
def main(db: str = typer.Option(STATE["db"], help="Ruta de la base DuckDB"),
         config: str = typer.Option(STATE["config"], help="Perfil del proyecto (YAML)")):
    STATE["db"], STATE["config"] = db, config


def _store() -> Store:
    return Store(STATE["db"])


def _cfg() -> Config:
    if not Path(STATE["config"]).exists():
        raise typer.BadParameter(f"No existe {STATE['config']}. Corre `warmpath init` y edítalo.")
    return Config.load(STATE["config"])


def _echo(d) -> None:
    typer.echo(json.dumps(d, indent=2, ensure_ascii=False, default=str))


# ------------------------------------------------------------------------ setup
@app.command()
def init():
    """Crea la base y copia las plantillas de configuración si no existen."""
    s = _store()
    for name in ("project", "rounds"):
        src, dst = ROOT / "config" / f"{name}.example.yaml", Path("config") / f"{name}.yaml"
        if src.exists() and not dst.exists():
            dst.parent.mkdir(exist_ok=True)
            shutil.copy(src, dst)
            typer.echo(f"Creado {dst} — edítalo.")
    _echo(s.stats())


@app.command()
def stats():
    """Conteos por tabla."""
    _echo(_store().stats())


# ------------------------------------------------------------------------ SEC
@app.command("formd-download")
def formd_download(quarter: str = typer.Argument(..., help="p.ej. 2026q2")):
    """Descarga el Form D Data Set trimestral (requiere SEC_USER_AGENT con email)."""
    from .ingest.sec_formd import download_quarter

    typer.echo(str(download_quarter(quarter)))


@app.command("formd-columns")
def formd_columns(zip_path: Path):
    """Imprime los encabezados de cada TSV del zip (para verificar el formato)."""
    from .ingest.sec_formd import list_zip_columns

    _echo(list_zip_columns(zip_path))


@app.command("formd-load")
def formd_load(zip_path: list[Path]):
    """Carga uno o más zips trimestrales a fd_filing / fd_person."""
    from .ingest.sec_formd import load_zip

    s = _store()
    _echo({str(z): load_zip(s, z) for z in zip_path})


@app.command("formd-derive")
def formd_derive(since: str = typer.Option(None, help="YYYY-MM-DD: solo fondos con Form D desde esta fecha")):
    """Fondos VC + partners + Form D de comparables -> entidades y aristas con procedencia."""
    from .ingest.sec_formd import derive_entities

    _echo(derive_entities(_store(), _cfg(), since=date.fromisoformat(since) if since else None))


@app.command("edgar-search")
def edgar_search(query: str, since: str = typer.Option(..., help="YYYY-MM-DD"), max_hits: int = 50):
    """Form D recientes vía full-text search de EDGAR (frescura < 1 trimestre)."""
    from .ingest.edgar import fetch_and_store, search_formd

    hits = search_formd(query, date.fromisoformat(since), max_hits=max_hits)
    _echo({"hits": len(hits), "stored": fetch_and_store(_store(), hits)})


@app.command("adv-load")
def adv_load(firms_csv: Path, schedule_a: Path = typer.Option(None), all_firms: bool = False):
    """Form ADV: AUM/CRD/web de fondos conocidos (+ Schedule A opcional). [verificar formato]"""
    from .ingest.form_adv import load_firms, load_schedule_a

    s = _store()
    out = {"firms": load_firms(s, firms_csv, only_matching_funds=not all_firms)}
    if schedule_a:
        out["schedule_a"] = load_schedule_a(s, schedule_a)
    _echo(out)


# ------------------------------------------------------------------------ red del founder
def _owner(name: str | None, email: str | None, linkedin: str | None) -> tuple[Person, str | None]:
    cfg = _cfg()
    if name:  # export de OTRO founder (pooling) -> exige consentimiento
        from .ingest.linkedin import owner_entity

        primary = owner_entity(_store(), cfg.founder)
        return Person(name=name, email=email or "", linkedin_url=linkedin or ""), primary
    return cfg.founder, None


@app.command()
def linkedin(folder: Path, owner_name: str = typer.Option(None, help="Solo para exports de otros founders (pooling)"),
             owner_email: str = None, owner_linkedin: str = None):
    """Parser propio del export oficial de LinkedIn (Connections.csv + messages.csv)."""
    from .ingest.linkedin import fund_affiliations, ingest_export

    s = _store()
    person, primary = _owner(owner_name, owner_email, owner_linkedin)
    out = ingest_export(s, folder, person, primary_owner=primary)
    out["fund_affiliations"] = fund_affiliations(s)
    _echo(out)


@app.command()
def outlook(path: Path, owner_name: str = None, owner_email: str = None, extra_email: list[str] = typer.Option([])):
    """Export local de Outlook: carpeta o archivo .ics / .olm / .eml / mbox (.pst -> readpst primero)."""
    from .ingest.linkedin import owner_entity, require_consent
    from .ingest.outlook import ingest_path

    s = _store()
    person, primary = _owner(owner_name, owner_email, None)
    oid = owner_entity(s, person)
    require_consent(s, oid, primary)
    _echo({"owner": oid, "interactions": ingest_path(s, path, oid, [person.email, *extra_email])})


@consent_app.command("add")
def consent_add(name: str, email: str = "", linkedin: str = "", scope: str = "linkedin+outlook headers; pooling piloto"):
    """Registra el consentimiento explícito de otro founder para usar su red."""
    from .ingest.linkedin import owner_entity

    s = _store()
    oid = owner_entity(s, Person(name=name, email=email, linkedin_url=linkedin))
    s.con.execute("INSERT OR REPLACE INTO consents VALUES (?,?,?,NULL)", [oid, datetime.now(), scope])
    typer.echo(f"Consentimiento registrado para {oid}")


@consent_app.command("revoke")
def consent_revoke(owner_id: str, purge: bool = typer.Option(True, help="Borra también sus interacciones")):
    """Revoca (y por defecto borra) los datos aportados por un founder."""
    s = _store()
    s.con.execute("UPDATE consents SET revoked_at=? WHERE owner=?", [datetime.now(), owner_id])
    if purge:
        s.con.execute("DELETE FROM interactions WHERE owner=?", [owner_id])
        s.con.execute("DELETE FROM edges WHERE owner=?", [owner_id])
    typer.echo(f"Revocado {owner_id}" + (" y datos borrados" if purge else ""))


# ------------------------------------------------------------------------ comparables / fondos
@app.command()
def rounds(path: Path = typer.Argument(Path("config/rounds.yaml"))):
    """Ingiere rondas de comparables (cada una con source_url + snippet literal)."""
    from .ingest.rounds import ingest_rounds

    _echo(ingest_rounds(_store(), _cfg(), path))


@app.command("extract-round")
def extract_round(url: str):
    """Usa el LLM configurado para proponer la entrada YAML de una ronda desde un anuncio (verifica la cita)."""
    from . import llm
    from .http import PoliteClient
    from .ingest.fund_web import html_to_text

    if not llm.available():
        raise typer.BadParameter("Falta ANTHROPIC_API_KEY")
    r = PoliteClient().get(url)
    data = llm.extract_round(html_to_text(r.text), url)
    if not data:
        typer.echo("No se pudo extraer una ronda con cita verificable.")
        raise typer.Exit(1)
    typer.echo(yaml.safe_dump({"rounds": [data]}, allow_unicode=True, sort_keys=False))


@app.command("enrich-funds")
def enrich_funds(limit: int = 40, only_ranked: bool = True):
    """Webs de fondos -> tesis/ticket/equipo/portafolio con cita (respeta robots.txt)."""
    from .ingest.fund_web import enrich_fund

    s = _store()
    if only_ranked and s.q("SELECT count(*) FROM recommendations")[0][0]:
        rows = s.q("""SELECT DISTINCT e.entity_id, e.domain FROM recommendations r JOIN entities e
                      ON e.entity_id=r.investor_id WHERE e.domain IS NOT NULL LIMIT ?""", [limit])
    else:
        rows = s.q("SELECT entity_id, domain FROM entities WHERE kind='fund' AND domain IS NOT NULL LIMIT ?", [limit])
    _echo([enrich_fund(s, fid, dom) for fid, dom in rows])


@app.command()
def openalex(limit: int = 200):
    """Co-autorías entre founder, contactos de 1er grado y partners (OpenAlex)."""
    from .ingest.academic import coauthor_edges

    s = _store()
    ids = [r[0] for r in s.q("""
        SELECT DISTINCT entity_id FROM entities WHERE kind='person' AND (
            json_extract(attrs,'$.is_founder')::BOOLEAN IS TRUE
            OR entity_id IN (SELECT src FROM edges WHERE rel='partner_of')
            OR entity_id IN (SELECT contact_id FROM interactions WHERE channel<>'li_connection'))
        LIMIT ?""", [limit])]
    _echo({"people": len(ids), "coauthor_edges": coauthor_edges(s, ids)})


@app.command()
def reporter(org: list[str]):
    """Grants NIH (RePORTER) de organizaciones, p.ej. los comparables."""
    from .ingest.academic import reporter_grants

    _echo({"projects": reporter_grants(_store(), org)})


# ------------------------------------------------------------------------ resolución
@app.command()
def resolve(engine: str = typer.Option("auto", help="auto | splink | rules")):
    """Resolución de entidades: reglas + probabilístico + cola de revisión."""
    from .resolve import resolve as _resolve

    _echo(_resolve(_store(), engine))


@review_app.command("list")
def review_list(limit: int = 30):
    from .resolve import review_list as _rl

    _echo(_rl(_store(), limit))


@review_app.command("accept")
def review_accept(left_id: str, right_id: str):
    from .resolve import review_decide

    review_decide(_store(), left_id, right_id, True)
    typer.echo("Aceptado. Corre `warmpath resolve` para aplicar.")


@review_app.command("reject")
def review_reject(left_id: str, right_id: str):
    from .resolve import review_decide

    review_decide(_store(), left_id, right_id, False)
    typer.echo("Rechazado.")


@app.command("confirm-edge")
def confirm_edge(a: str, b: str, note: str = typer.Option("Confirmado por el founder")):
    """El founder confirma con 1 clic un vínculo hipotético (o declara uno que conoce)."""
    s = _store()
    pid = s.add_prov("manual", None, note, 1.0)
    s.add_edge(a, b, "knows", strength=0.6, evidence=note, prov_id=pid)
    typer.echo("Arista confirmada (s=0.6).")


# ------------------------------------------------------------------------ ranking / reporte
@app.command()
def run(out: Path = Path("out"), skip_resolve: bool = False, embeddings: bool = True):
    """Pipeline: resolve → vínculos públicos 2º salto → candidatos + caminos → reporte."""
    from . import report
    from .candidates import rank
    from .ingest.sec_formd import link_people_to_formd
    from .resolve import resolve as _resolve
    from .thesis import Similarity

    s, cfg = _store(), _cfg()
    if not skip_resolve:
        typer.echo(f"resolve: {_resolve(s)}")
    try:
        typer.echo(f"co_director 2º salto: {link_people_to_formd(s)}")
    except Exception as e:  # sin tablas Form D todavía
        typer.echo(f"(sin Form D: {e.__class__.__name__})")
    sim = Similarity(prefer_embeddings=embeddings)
    recs = rank(s, cfg, sim=sim)
    d = report.write(s, cfg, recs, out, sim_method=sim.method)
    typer.echo(f"{len(recs)} recomendaciones → {d}")


@app.command()
def path(fund_id: str, k: int = 3):
    """Muestra los k mejores caminos del founder a un fondo (debug)."""
    from .candidates import founder_id
    from .graph import build_path_graph
    from .paths import top_paths, widest_path

    s, cfg = _store(), _cfg()
    G = build_path_graph(s)
    me = founder_id(s, cfg)
    from .graph import add_declared

    add_declared(G, s, cfg, me)
    _echo({"top": top_paths(G, me, s.canonical(fund_id), k, cfg.hop_penalty, cfg.max_hops),
           "widest": widest_path(G, me, s.canonical(fund_id), cfg.max_hops)})


@app.command()
def outcome(fund_id: str, stage: str, connector: str = "", note: str = ""):
    """Registra el resultado de una intro: intro_pedida → intro_aceptada → reunion → dd → term_sheet
    (o rechazada / sin_respuesta)."""
    if stage not in OUTCOME_STAGES:
        raise typer.BadParameter(f"stage debe ser uno de {OUTCOME_STAGES}")
    s = _store()
    run_id = (s.q("SELECT max(run_id) FROM recommendations")[0][0]) or ""
    s.con.execute("INSERT INTO outcomes VALUES (?,?,?,?,?,?)", [fund_id, connector, stage, datetime.now(), note, run_id])
    _echo(s.qd("SELECT stage, count(*) n FROM outcomes GROUP BY stage ORDER BY n DESC"))


@app.command()
def backtest(k: int = 20):
    """hit@K / NDCG@K ocultando la última ronda de cada comparable (corte temporal)."""
    from .backtest import run as _bt

    _echo(_bt(_store(), _cfg(), k))


if __name__ == "__main__":
    app()
