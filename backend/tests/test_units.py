from datetime import datetime

import networkx as nx
import pytest

from warmpath.ingest.edgar import parse_formd_xml
from warmpath.llm import quote_in_text
from warmpath.models import Round
from warmpath.normalize import jaro_winkler, norm_linkedin, norm_org, person_id
from warmpath.paths import top_paths, widest_path
from warmpath.strength import TieFeatures, noisy_or, strength_from_features


def test_norm_org():
    assert norm_org("Acme Ventures Fund III, L.P.") == "acme ventures"
    assert norm_org("Acme Capital Partners LLC") == "acme capital partners"
    assert norm_org("CompOne Inc") == norm_org("CompOne, Inc.")


def test_linkedin_and_ids():
    assert norm_linkedin("https://www.linkedin.com/in/Jane-Doe/?x=1") == "in/jane-doe"
    assert norm_linkedin("https://linkedin.com/company/acme") == ""
    assert person_id(linkedin="linkedin.com/in/jane") == "p:li:jane"
    assert person_id(email="J@X.com") == "p:em:j@x.com"


def test_jaro_winkler():
    assert jaro_winkler("martha", "marhta") == pytest.approx(0.961, abs=1e-3)
    assert jaro_winkler("abc", "xyz") == 0.0


def test_round_requires_citation():
    with pytest.raises(ValueError):
        Round(company="X", date="2024-01-01", investors=[{"name": "F"}], source_url="", snippet="")


def test_quote_verification():
    text = "We invest   at Seed in digital health companies across the US."
    assert quote_in_text("invest at seed in digital health", text)
    assert not quote_in_text("we invest in crypto", text)


def test_strength_monotonic():
    now = datetime(2026, 9, 1)
    base = TieFeatures(connected=datetime(2020, 1, 1))
    rich = TieFeatures(n_msgs=10, n_emails=8, n_meetings=3, n_small_meetings=3, n_in=9, n_out=9,
                       first=datetime(2021, 1, 1), last=datetime(2026, 8, 20), connected=datetime(2020, 1, 1),
                       channels={"li_message", "email", "meeting"})
    s0, s1 = strength_from_features(base.vector(now)), strength_from_features(rich.vector(now))
    assert 0.05 < s0 < 0.25 < 0.85 < s1 < 0.96
    assert noisy_or([0.5, 0.5]) == 0.75


def _g(edges):
    G = nx.Graph()
    for a, b, s in edges:
        G.add_edge(a, b, s=s, hypothesis=False, rels=[{"rel": "knows", "s": s, "evidence": "", "source": "t", "hypothesis": False}])
    for n in G.nodes:
        G.nodes[n].update(kind="fund" if n.startswith("F") else "person", name=n)
    return G


def test_strength_beats_distance():
    # 2 saltos débiles vs 3 saltos fuertes: gana el fuerte
    G = _g([("me", "weak", 0.1), ("weak", "F", 0.9), ("me", "a", 0.9), ("a", "b", 0.8), ("b", "F", 0.9)])
    p = top_paths(G, "me", "F", k=2, hop_penalty=0.25)
    assert p[0]["nodes"] == ["me", "a", "b", "F"]
    assert p[1]["nodes"] == ["me", "weak", "F"]
    assert widest_path(G, "me", "F")["weakest"] == 0.8


def test_no_path_through_funds_or_limit():
    G = _g([("me", "F2", 0.9), ("F2", "F", 0.9)])
    assert top_paths(G, "me", "F") == []  # un fondo no es intermediario
    G2 = _g([("me", "a", .9), ("a", "b", .9), ("b", "c", .9), ("c", "d", .9), ("d", "F", .9)])
    assert top_paths(G2, "me", "F", max_hops=4) == []


def test_parse_formd_xml():
    xml = """<?xml version="1.0"?><edgarSubmission xmlns="http://www.sec.gov/edgar/formd">
    <primaryIssuer><cik>0001234567</cik><entityName>Alpha Health Ventures III, L.P.</entityName>
      <issuerAddress><city>Boston</city><stateOrCountry>MA</stateOrCountry></issuerAddress></primaryIssuer>
    <relatedPersonsList><relatedPersonInfo><relatedPersonName><firstName>Jane</firstName><lastName>Partner</lastName>
      </relatedPersonName><relatedPersonAddress><city>Boston</city><stateOrCountry>MA</stateOrCountry></relatedPersonAddress>
      <relatedPersonRelationshipList><relationship>Executive Officer</relationship></relatedPersonRelationshipList>
      </relatedPersonInfo></relatedPersonsList>
    <offeringData><industryGroup><industryGroupType>Pooled Investment Fund</industryGroupType>
      <investmentFundInfo><investmentFundType>Venture Capital Fund</investmentFundType></investmentFundInfo></industryGroup>
      <typeOfFiling><newOrAmendment><isAmendment>false</isAmendment></newOrAmendment>
      <dateOfFirstSale><value>2026-07-01</value></dateOfFirstSale></typeOfFiling>
      <offeringSalesAmounts><totalOfferingAmount>200000000</totalOfferingAmount><totalAmountSold>50000000</totalAmountSold>
      </offeringSalesAmounts></offeringData></edgarSubmission>"""
    f, ps = parse_formd_xml(xml, "0001234567-26-000009")
    assert f["cik"] == "1234567" and f["fund_type"] == "Venture Capital Fund" and f["total_offering"] == 2e8
    assert ps[0]["last_name"] == "Partner" and ps[0]["relationships"] == "Executive Officer"


def test_resolution_prob_and_review(store):
    from warmpath.resolve import resolve, review_list

    pid = store.add_prov("manual")
    store.upsert_entity("p:nm:jane-partner@alpha-health-ventures", "person", "Jane Partner", org_name="Alpha Health Ventures", prov_id=pid)
    store.upsert_entity("p:li:jane-p", "person", "Jane Partner", org_name="Alpha Health Ventures Fund II LP",
                        linkedin="in/jane-p", prov_id=pid)
    store.upsert_entity("p:nm:jane-partnr@alpha-health", "person", "Jane Partnr", org_name="Alpha Health", prov_id=pid)
    store.upsert_entity("p:nm:jane-partner@other-co", "person", "Jane Partner", org_name="Totally Different Co", prov_id=pid)
    out = resolve(store, engine="rules")
    # nombre + org normalizada idénticos -> regla determinista; canónico = id de LinkedIn
    assert store.canonical("p:nm:jane-partner@alpha-health-ventures") == "p:li:jane-p"
    # typo + org parecida -> probabilístico (auto o revisión), nunca ignorado
    assert out["auto_prob"] + out["to_review"] >= 1
    # misma persona en otra empresa -> no se fusiona automáticamente
    assert store.canonical("p:nm:jane-partner@other-co") == "p:nm:jane-partner@other-co"
    assert isinstance(review_list(store), list)


class _FakeResp:
    def __init__(self, text, status_code=200):
        self.text, self.status_code = text, status_code


class _FakeClient:
    """Simula PoliteClient.get() devolviendo la página índice de la SEC (HTML recortado real)."""
    ua = "test"
    def __init__(self, html):
        self.html = html
    def get(self, url, **kw):
        return _FakeResp(self.html)


SEC_INDEX_HTML = """
<table>
<tr><td><a href="/files/datastandardsinnovation/data/form-d-data-sets/2026q2_d.zip">2026 Q2</a></td></tr>
<tr><td><a href="/files/structureddata/data/form-d-data-sets/2026q1_d.zip">2026 Q1</a></td></tr>
<tr><td><a href="/files/structureddata/data/form-d-data-sets/2013q4_d_0.zip">2013 Q4</a></td></tr>
</table>
"""


def test_resolve_quarter_url_reads_index_page():
    from warmpath.ingest.sec_formd import resolve_quarter_url

    client = _FakeClient(SEC_INDEX_HTML)
    assert resolve_quarter_url("2026q2", client) == \
        "https://www.sec.gov/files/datastandardsinnovation/data/form-d-data-sets/2026q2_d.zip"
    # trimestre distinto con el prefijo viejo, y el sufijo "_0" no debe confundirse con otro trimestre
    assert resolve_quarter_url("2026q1", client) == \
        "https://www.sec.gov/files/structureddata/data/form-d-data-sets/2026q1_d.zip"
    assert resolve_quarter_url("2013q4", client) == \
        "https://www.sec.gov/files/structureddata/data/form-d-data-sets/2013q4_d_0.zip"


def test_resolve_quarter_url_no_match_in_page_raises_without_network():
    from warmpath.ingest.sec_formd import resolve_quarter_url

    client = _FakeClient(SEC_INDEX_HTML)
    with pytest.raises(FileNotFoundError):
        resolve_quarter_url("1999q1", client)  # no está en la página ni coincide con los prefijos (sin red real aquí)


def test_declared_network_opens_warm_path():
    """Equipo + contacto declarado crean un camino founder → cofounder → partner → fondo."""
    import networkx as nx

    from warmpath.db import Store
    from warmpath.graph import add_declared
    from warmpath.models import Config
    from warmpath.paths import top_paths

    s = Store(":memory:")
    s.upsert_entity("f:nm:gamma", "fund", "Gamma Bio Ventures")
    cfg = Config.model_validate({
        "project": {"name": "X", "one_liner": "y"},
        "founder": {"name": "Ana Founder"},
        "comparables": [{"name": "C1"}],
        "team": [{"name": "Luis Cofounder", "role": "cofounder"}],
        "contacts": [{"name": "Marta Partner", "org": "Gamma Bio Ventures", "known_by": "Luis Cofounder",
                      "strength": "fuerte"}],
        "affiliations": [{"name": "Universidad Andina", "kind": "universidad"}],
    })
    G = nx.Graph()
    stats = add_declared(G, s, cfg, "p:nm:ana-founder")
    assert stats["team"] == 1 and stats["contacts"] == 1 and stats["contacts_at_fund"] == 1
    paths = top_paths(G, "p:nm:ana-founder", "f:nm:gamma", k=1, max_hops=4)
    assert paths and paths[0]["n_hops"] == 3
    assert [h["rel"] for h in paths[0]["hops"]] == ["team", "knows", "partner_of"]


def test_funding_types_default_and_validation():
    from warmpath.models import ProjectProfile
    assert ProjectProfile(name="X", one_liner="y").funding_types == ["venture"]
    assert ProjectProfile(name="X", one_liner="y", funding_types=["grant"]).funding_types == ["grant"]
