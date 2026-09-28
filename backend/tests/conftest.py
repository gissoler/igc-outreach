"""Fixtures 100% SINTÉTICAS (nombres inventados). Solo para tests; nunca van a un output real."""
from __future__ import annotations

import zipfile
from datetime import datetime, timedelta
from pathlib import Path

import pytest
import yaml

from warmpath.db import Store
from warmpath.models import Config

NOW = datetime(2026, 9, 1)


def _tsv(rows: list[list[str]]) -> str:
    return "\n".join("\t".join(r) for r in rows) + "\n"


@pytest.fixture
def formd_zip(tmp_path: Path) -> Path:
    sub = [["ACCESSIONNUMBER", "FILE_NUM", "FILING_DATE", "SIC_CODE", "SCHEMAVERSION", "SUBMISSIONTYPE", "TESTORLIVE"],
           ["0000000001-26-000001", "021-1", "15-APR-2026", "", "X0708", "D", "LIVE"],
           ["0000000002-26-000002", "021-2", "20-MAY-2026", "", "X0708", "D", "LIVE"],
           ["0000000003-26-000003", "021-3", "02-JUN-2026", "", "X0708", "D", "LIVE"],
           ["0000000004-26-000004", "021-4", "10-JUN-2026", "", "X0708", "D", "LIVE"]]
    iss = [["ACCESSIONNUMBER", "IS_PRIMARYISSUER_FLAG", "ISSUER_SEQ_KEY", "CIK", "ENTITYNAME", "CITY", "STATEORCOUNTRY"],
           ["0000000001-26-000001", "YES", "1", "0000100001", "Alpha Health Ventures Fund II, L.P.", "Boston", "MA"],
           ["0000000002-26-000002", "YES", "1", "0000100002", "Beta Seed Fund I LP", "Austin", "TX"],
           ["0000000003-26-000003", "YES", "1", "0000200001", "CompOne Inc", "New York", "NY"],
           ["0000000004-26-000004", "YES", "1", "0000300001", "Random Real Estate LLC", "Miami", "FL"]]
    off = [["ACCESSIONNUMBER", "INDUSTRYGROUPTYPE", "INVESTMENTFUNDTYPE", "ISAMENDMENT", "SALE_DATE",
            "TOTALOFFERINGAMOUNT", "TOTALAMOUNTSOLD"],
           ["0000000001-26-000001", "Pooled Investment Fund", "Venture Capital Fund", "false", "2026-04-01", "150000000", "90000000"],
           ["0000000002-26-000002", "Pooled Investment Fund", "Venture Capital Fund", "false", "2026-05-01", "40000000", "40000000"],
           ["0000000003-26-000003", "Other Health Care", "", "false", "2026-05-20", "4000000", "4000000"],
           ["0000000004-26-000004", "Pooled Investment Fund", "Other Investment Fund", "false", "2026-06-01", "9000000", "0"]]
    rel = [["ACCESSIONNUMBER", "RELATEDPERSON_SEQ_KEY", "FIRSTNAME", "MIDDLENAME", "LASTNAME", "CITY", "STATEORCOUNTRY",
            "RELATIONSHIP_1", "RELATIONSHIP_2", "RELATIONSHIP_3", "RELATIONSHIPCLARIFICATION"],
           ["0000000001-26-000001", "1", "Jane", "", "Partner", "Boston", "MA", "Executive Officer", "", "", "Managing Member of GP"],
           ["0000000001-26-000001", "2", "Alpha Health GP", "", "LLC", "Boston", "MA", "Promoter", "", "", ""],
           ["0000000002-26-000002", "1", "Carl", "", "Beta", "Austin", "TX", "Executive Officer", "", "", ""],
           ["0000000003-26-000003", "1", "Jane", "", "Partner", "Boston", "MA", "Director", "", "", ""],
           ["0000000003-26-000003", "2", "Ana", "", "Connector", "New York", "NY", "Executive Officer", "", "", "COO"],
           ["0000000003-26-000003", "3", "Chris", "", "Ceo", "New York", "NY", "Executive Officer", "Director", "", ""]]
    z = tmp_path / "2026q2_d.zip"
    with zipfile.ZipFile(z, "w") as f:
        for name, rows in (("FORMDSUBMISSION", sub), ("ISSUERS", iss), ("OFFERING", off), ("RELATEDPERSONS", rel)):
            f.writestr(f"2026Q2_d/{name}.tsv", _tsv(rows))
    return z


@pytest.fixture
def linkedin_dir(tmp_path: Path) -> Path:
    d = tmp_path / "linkedin"
    d.mkdir()
    (d / "Connections.csv").write_text(
        "Notes:\n\"When exporting your connection data, you may notice that some of the email addresses are missing.\"\n\n"
        "First Name,Last Name,URL,Email Address,Company,Position,Connected On\n"
        "Ana,Connector,https://www.linkedin.com/in/ana-connector,ana@compone.io,CompOne Inc,COO,12 Mar 2019\n"
        "Pedro,Partner,https://www.linkedin.com/in/pedro-partner,,Beta Seed,Partner,01 Jan 2024\n"
        "Wendy,Weak,https://www.linkedin.com/in/wendy-weak,,Some Corp,Analyst,05 May 2025\n", encoding="utf-8")
    rows = ["CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER"]
    for i in range(12):
        ts = (NOW - timedelta(days=10 + 20 * i)).strftime("%Y-%m-%d %H:%M:%S UTC")
        if i % 2 == 0:
            rows.append(f"c1,,Fiona Founder,https://www.linkedin.com/in/fiona-founder,Ana Connector,"
                        f"https://www.linkedin.com/in/ana-connector,{ts},,SECRET BODY,INBOX")
        else:
            rows.append(f"c1,,Ana Connector,https://www.linkedin.com/in/ana-connector,Fiona Founder,"
                        f"https://www.linkedin.com/in/fiona-founder,{ts},,SECRET BODY,INBOX")
    rows.append(f"c2,,Fiona Founder,https://www.linkedin.com/in/fiona-founder,Pedro Partner,"
                f"https://www.linkedin.com/in/pedro-partner,{(NOW - timedelta(days=400)).strftime('%Y-%m-%d %H:%M:%S UTC')},,hi,INBOX")
    (d / "messages.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
    return d


@pytest.fixture
def outlook_dir(tmp_path: Path) -> Path:
    d = tmp_path / "outlook"
    d.mkdir()
    ev = []
    for i in range(3):
        dt = (NOW - timedelta(days=30 * (i + 1))).strftime("%Y%m%dT150000Z")
        ev.append(f"BEGIN:VEVENT\nUID:{i}@x\nDTSTART:{dt}\nSUMMARY:sync\n"
                  f"ORGANIZER;CN=Fiona Founder:mailto:fiona@mentiva.co\n"
                  f"ATTENDEE;CN=Ana Connector:mailto:ana@compone.io\nEND:VEVENT")
    (d / "cal.ics").write_text("BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//t//t//EN\n" + "\n".join(ev) + "\nEND:VCALENDAR\n")
    (d / "m1.eml").write_text("From: Ana Connector <ana@compone.io>\nTo: Fiona Founder <fiona@mentiva.co>\n"
                              "Date: Mon, 3 Aug 2026 10:00:00 +0000\nSubject: private\n\nBODY NOT STORED\n")
    (d / "m2.eml").write_text("From: newsletter@spam.com\nTo: fiona@mentiva.co\nDate: Mon, 3 Aug 2026 10:00:00 +0000\n\nx\n")
    return d


@pytest.fixture
def rounds_file(tmp_path: Path) -> Path:
    data = {"rounds": [
        {"company": "CompOne Inc", "date": "2024-02-01", "stage": "seed", "amount_usd": 3e6,
         "investors": [{"name": "Gamma Bio Capital", "lead": True}, {"name": "Alpha Health Ventures"}],
         "source_url": "https://example.test/compone-seed", "snippet": "led by Gamma Bio Capital with Alpha Health Ventures"},
        {"company": "CompTwo", "date": "2025-06-01", "stage": "seed",
         "investors": [{"name": "Gamma Bio Capital"}, {"name": "Delta Angels"}],
         "source_url": "https://example.test/comptwo", "snippet": "Gamma Bio Capital and Delta Angels invested"},
        {"company": "CompTwo", "date": "2026-03-01", "stage": "series-a",
         "investors": [{"name": "Epsilon Growth", "lead": True}, {"name": "Gamma Bio Capital"}],
         "source_url": "https://example.test/comptwo-a", "snippet": "Epsilon Growth led, Gamma Bio Capital followed"},
        {"company": "OtherCo", "date": "2023-05-01", "stage": "seed",
         "investors": [{"name": "Gamma Bio Capital"}, {"name": "Zeta Health Fund"}],
         "source_url": "https://example.test/otherco", "snippet": "Gamma Bio Capital and Zeta Health Fund back OtherCo"},
    ]}
    p = tmp_path / "rounds.yaml"
    p.write_text(yaml.safe_dump(data))
    return p


@pytest.fixture
def cfg() -> Config:
    return Config.model_validate({
        "project": {"name": "TestProj", "one_liner": "digital mental health wearables", "sectors": ["mental health"],
                    "stage": "pre-seed"},
        "founder": {"name": "Fiona Founder", "email": "fiona@mentiva.co",
                    "linkedin_url": "https://www.linkedin.com/in/fiona-founder"},
        "comparables": [{"name": "CompOne Inc"}, {"name": "CompTwo"}],
        "filters": {"stages_allowed": ["pre-seed", "seed"]},
        "top_n": 10,
    })


@pytest.fixture
def store() -> Store:
    return Store(":memory:")
