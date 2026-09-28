"""Smoke test de la CLI completa sobre las fixtures sintéticas."""
import json

import yaml
from typer.testing import CliRunner

from warmpath.cli import app


def test_cli_flow(tmp_path, cfg, formd_zip, rounds_file, linkedin_dir, outlook_dir, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "config/project.yaml").write_text(yaml.safe_dump(cfg.model_dump(mode="json")))
    r = CliRunner()

    def ok(*args):
        res = r.invoke(app, list(args))
        assert res.exit_code == 0, res.output + repr(res.exception)
        return res.output

    ok("init")
    ok("formd-load", str(formd_zip))
    ok("rounds", str(rounds_file))
    ok("formd-derive")
    ok("linkedin", str(linkedin_dir))
    ok("outlook", str(outlook_dir))
    out = ok("run", "--out", str(tmp_path / "out"), "--no-embeddings")
    assert "recomendaciones" in out
    ok("outcome", "f:nm:gamma-bio", "intro_pedida", "--connector", "p:li:ana-connector")
    bt = json.loads(ok("backtest", "--k", "10"))
    assert bt["per_comparable"]
    stats = json.loads(ok("stats"))
    assert stats["outcomes"] == 1 and stats["fd_filing" if "fd_filing" in stats else "entities"] > 0
    # pooling sin consentimiento -> error; con consentimiento -> OK
    res = r.invoke(app, ["linkedin", str(linkedin_dir), "--owner-name", "Pascal Pilot",
                         "--owner-linkedin", "https://www.linkedin.com/in/pascal"])
    assert res.exit_code != 0
    ok("consent", "add", "Pascal Pilot", "--linkedin", "https://www.linkedin.com/in/pascal")
    ok("linkedin", str(linkedin_dir), "--owner-name", "Pascal Pilot", "--owner-linkedin", "https://www.linkedin.com/in/pascal")
    ok("consent", "revoke", "p:li:pascal")
