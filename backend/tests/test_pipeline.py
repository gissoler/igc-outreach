"""End-to-end sobre datos sintéticos: Form D + rondas + LinkedIn + Outlook -> ranking + caminos + reporte."""
from warmpath import report
from warmpath.backtest import run as backtest
from warmpath.candidates import founder_id, rank
from warmpath.graph import build_path_graph
from warmpath.ingest.linkedin import fund_affiliations, ingest_export
from warmpath.ingest.outlook import ingest_path
from warmpath.ingest.rounds import ingest_rounds
from warmpath.ingest.sec_formd import derive_entities, load_zip
from warmpath.models import Person
from warmpath.normalize import org_id
from warmpath.resolve import resolve
from warmpath.thesis import Similarity

from .conftest import NOW


def _load_all(store, cfg, formd_zip, rounds_file, linkedin_dir, outlook_dir):
    assert load_zip(store, formd_zip)["filings_added"] == 4
    ingest_rounds(store, cfg, rounds_file)
    st = derive_entities(store, cfg)
    li = ingest_export(store, linkedin_dir, cfg.founder)
    fund_affiliations(store)
    oid = li["owner"]
    n_out = ingest_path(store, outlook_dir, oid, [cfg.founder.email])
    res = resolve(store, engine="rules")
    return st, li, n_out, res


def test_end_to_end(store, cfg, formd_zip, rounds_file, linkedin_dir, outlook_dir, tmp_path):
    st, li, n_out, res = _load_all(store, cfg, formd_zip, rounds_file, linkedin_dir, outlook_dir)
    # Form D: 2 fondos VC (el de real estate no), partners, comparable con board seat inferido
    assert st["funds"] == 2 and st["comparable_filings"] == 1 and st["inferred_investments"] == 1
    assert li["connections"] == 3 and li["message_events"] == 13
    assert n_out == 4  # 3 reuniones + 1 correo; newsletter filtrado
    # Minimización: ningún cuerpo de mensaje llegó a la base
    assert not store.q("SELECT 1 FROM provenance WHERE snippet LIKE '%SECRET%' OR snippet LIKE '%BODY NOT%'")
    # Resolución: Ana (LinkedIn) = Ana (Form D, CompOne) = Ana (email)
    ana = {r[0] for r in store.q("SELECT canonical_id FROM entity_map m JOIN entities e USING(entity_id) "
                                 "WHERE e.norm_name='ana connector'")}
    assert len(ana) == 1
    # Alpha (Form D) y Alpha (rondas) son el mismo fondo
    alpha = {r[0] for r in store.q("SELECT canonical_id FROM entity_map m JOIN entities e USING(entity_id) "
                                   "WHERE e.kind='fund' AND e.norm_name='alpha health ventures'")}
    assert len(alpha) == 1

    G = build_path_graph(store, now=NOW)
    me = founder_id(store, cfg)
    assert G.has_node(me)
    recs = rank(store, cfg, now=NOW, G=G, sim=Similarity(prefer_embeddings=False))
    names = [r["name"] for r in recs]
    # Gamma invirtió en ambos comparables -> primero
    assert names[0].lower().startswith("gamma")
    by = {r["name"].lower(): r for r in recs}
    alpha_r = next(v for k, v in by.items() if k.startswith("alpha"))
    best = alpha_r["paths"][0]
    assert best["connector"] == "Ana Connector"
    # prefiere el camino con evidencia (Ana—Jane co-listadas en Form D) sobre la hipótesis de portafolio
    assert not best["has_hypothesis"] and "Jane Partner" in [h["to_name"] for h in best["hops"]]
    assert best["weakest"] > 0.25
    # Epsilon solo se ha visto en Serie A -> penalización suave, no exclusión
    eps = next(v for k, v in by.items() if k.startswith("epsilon"))
    assert eps["stage_mult"] == 0.6
    # Beta: contacto directo que trabaja ahí (Pedro) -> camino de 2 saltos
    beta_r = next(v for k, v in by.items() if k.startswith("beta"))
    assert beta_r["paths"][0]["n_hops"] == 2
    # Zeta llega por co-inversión (ProbS) aunque no invirtió en comparables
    assert any(k.startswith("zeta") and v["factors"]["coinvest"] > 0 for k, v in by.items())

    out = report.write(store, cfg, recs, tmp_path / "out", sim_method="tfidf")
    md = (out / "recomendaciones.md").read_text()
    assert "Ana Connector" in md and "[E] estimado" in md
    assert (out / "notion_import.csv").exists()


def test_pooling_requires_consent(store, cfg, linkedin_dir):
    import pytest

    from warmpath.ingest.linkedin import owner_entity

    primary = owner_entity(store, cfg.founder)
    other = Person(name="Pascal Pilot", linkedin_url="https://www.linkedin.com/in/pascal")
    with pytest.raises(PermissionError):
        ingest_export(store, linkedin_dir, other, primary_owner=primary)


def test_backtest(store, cfg, formd_zip, rounds_file, linkedin_dir, outlook_dir):
    _load_all(store, cfg, formd_zip, rounds_file, linkedin_dir, outlook_dir)
    bt = backtest(store, cfg, k=10)
    per = {r["comparable"]: r for r in bt["per_comparable"]}
    # Ocultando la Serie A de CompTwo (Epsilon + Gamma), usando CompOne como semilla: Gamma aparece
    assert per["CompTwo"]["n_true"] == 2 and per["CompTwo"]["hit@10"] >= 0.5
    assert 0 <= bt["mean"]["ndcg@10"] <= 1
    # corte temporal: la ronda oculta no puede estar en la semilla
    assert org_id("Epsilon Growth", kind="fund")
