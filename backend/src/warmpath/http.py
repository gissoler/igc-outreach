"""Cliente HTTP educado: User-Agent identificable, rate limit y robots.txt.

- SEC exige User-Agent con nombre + email y ≤10 req/s (usamos 5 por defecto).
- Webs de fondos: se respeta robots.txt y se hace volumen bajo (1 req/s).
"""
from __future__ import annotations

import os
import time
import urllib.robotparser
from urllib.parse import urlparse

import httpx

DEFAULT_UA = os.environ.get("WARMPATH_USER_AGENT", "WarmPathEngine/0.1 (research; contact: set WARMPATH_USER_AGENT)")


class PoliteClient:
    def __init__(self, user_agent: str | None = None, rps: float = 1.0, timeout: float = 30.0,
                 respect_robots: bool = True):
        self.ua = user_agent or DEFAULT_UA
        self.min_interval = 1.0 / rps
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.respect_robots = respect_robots
        self.client = httpx.Client(headers={"User-Agent": self.ua, "Accept-Encoding": "gzip, deflate"},
                                   timeout=timeout, follow_redirects=True)

    def _wait(self, host: str) -> None:
        dt = time.monotonic() - self._last.get(host, 0.0)
        if dt < self.min_interval:
            time.sleep(self.min_interval - dt)
        self._last[host] = time.monotonic()

    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        p = urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.client.get(base + "/robots.txt")
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
                self._robots[base] = rp
            except httpx.HTTPError:
                self._robots[base] = None  # sin robots accesible => permitido, con volumen bajo
        rp = self._robots[base]
        return True if rp is None else rp.can_fetch(self.ua, url)

    def get(self, url: str, **kw) -> httpx.Response:
        if not self.allowed(url):
            raise PermissionError(f"robots.txt no permite {url}")
        self._wait(urlparse(url).netloc)
        for attempt in range(3):
            r = self.client.get(url, **kw)
            if r.status_code in (429, 503):
                time.sleep(2 ** attempt * 2)
                continue
            return r
        return r

    def post(self, url: str, **kw) -> httpx.Response:
        self._wait(urlparse(url).netloc)
        return self.client.post(url, **kw)


def sec_client() -> PoliteClient:
    ua = os.environ.get("SEC_USER_AGENT") or os.environ.get("WARMPATH_USER_AGENT")
    if not ua or "@" not in ua:
        raise RuntimeError(
            "La SEC exige un User-Agent con nombre y email. Exporta p.ej.:\n"
            "  export SEC_USER_AGENT='Gisel Caicedo gisel@tu-dominio.com'"
        )
    # data.sec.gov / www.sec.gov no se rigen por robots para bulk data documentado
    return PoliteClient(user_agent=ua, rps=5.0, respect_robots=False)
