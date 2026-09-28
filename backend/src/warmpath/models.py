"""Modelos de entrada (perfil del proyecto, rondas de comparables) validados con pydantic."""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

Stage = Literal["pre-seed", "seed", "series-a", "series-b", "growth", "grant", "unknown"]
STAGE_ORDER = ["pre-seed", "seed", "series-a", "series-b", "growth"]


class Person(BaseModel):
    name: str
    title: str = ""  # rol: CEO, founder, director científico…
    email: str = ""
    linkedin_url: str = ""
    org: str = ""


class Comparable(BaseModel):
    name: str
    domain: str = ""
    sec_cik: str = ""
    aliases: list[str] = Field(default_factory=list)
    why: str = ""  # por qué es comparable (se muestra en el reporte)


TeamRole = Literal["cofounder", "equipo", "advisor", "board", "inversionista", "grupo"]
# Cercanía founder ↔ miembro por defecto (se puede sobrescribir con `closeness`).
ROLE_CLOSENESS = {"cofounder": 0.92, "equipo": 0.8, "board": 0.75, "advisor": 0.65, "inversionista": 0.7, "grupo": 0.6}
TIE_STRENGTH = {"fuerte": 0.8, "media": 0.55, "debil": 0.3}


class TeamMember(Person):
    """Persona del equipo o del grupo cuya red amplía los caminos cálidos.

    El founder queda unido a cada miembro con una arista `team`. Si `shares_network` es True y
    hay consentimiento, sus exports (LinkedIn/Outlook) entran al grafo como 1er grado propio.
    """
    role: TeamRole = "cofounder"
    shares_network: bool = False
    closeness: float | None = None  # 0–1; vacío = valor por rol

    def tie(self) -> float:
        return max(0.05, min(0.99, self.closeness if self.closeness is not None else ROLE_CLOSENESS[self.role]))


class DeclaredContact(BaseModel):
    """Contacto que el equipo declara conocer (sin export). Entra como arista `knows` de fuente manual."""
    name: str
    org: str = ""            # empresa o fondo donde trabaja
    linkedin_url: str = ""
    known_by: str = ""       # nombre de un miembro del equipo; vacío = founder
    strength: Literal["fuerte", "media", "debil"] = "media"
    note: str = ""


class Affiliation(BaseModel):
    """Universidad, empresa anterior, aceleradora, comunidad o grupo empresarial compartido.

    Se usa para proponer HIPÓTESIS de vínculo con personas del grafo que declaran la misma organización.
    """
    name: str
    kind: Literal["universidad", "empresa", "aceleradora", "comunidad", "grupo"] = "empresa"
    members: list[str] = Field(default_factory=list)  # nombres del equipo; vacío = founder


class Filters(BaseModel):
    stages_allowed: list[Stage] = Field(default_factory=lambda: ["pre-seed", "seed"])
    ticket_min_usd: float | None = None
    ticket_max_usd: float | None = None
    geos: list[str] = Field(default_factory=list)  # códigos tipo US, CO, EU; vacío = sin filtro
    require_known_stage: bool = False  # True = descarta fondos con etapa desconocida


class Weights(BaseModel):
    """Pesos del score explicable. Se normalizan a suma 1."""
    seed: float = 0.30        # invirtió en un comparable
    coinvest: float = 0.20    # difusión ProbS por co-inversión
    thesis: float = 0.25      # similitud tesis ↔ perfil
    path: float = 0.20        # fuerza del mejor camino cálido
    activity: float = 0.05    # levantó fondo / invirtió recientemente

    def normalized(self) -> dict[str, float]:
        d = self.model_dump()
        tot = sum(d.values()) or 1.0
        return {k: v / tot for k, v in d.items()}


FundingType = Literal["grant", "venture", "angel", "corporate", "debt", "bootstrapping"]
FUNDING_LABELS = {"grant": "grants (no dilutivo)", "venture": "venture capital", "angel": "ángeles",
                  "corporate": "corporativo / estratégico", "debt": "deuda / venture debt",
                  "bootstrapping": "bootstrapping / ingresos"}
# Tipos de financiación que un fondo de venture (Form D, VC) puede cubrir.
VC_COMPATIBLE = {"venture", "angel", "corporate"}


class ProjectProfile(BaseModel):
    """Producto que se quiere financiar (la financiación se busca por producto, no por toda la empresa)."""
    name: str
    one_liner: str
    description: str = ""
    sectors: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    stage: Stage = "pre-seed"
    raise_usd: float | None = None
    geo: list[str] = Field(default_factory=list)
    funding_types: list[FundingType] = Field(default_factory=lambda: ["venture"])

    def thesis_text(self) -> str:
        return " ".join([self.one_liner, self.description, " ".join(self.sectors), " ".join(self.keywords)])


class Config(BaseModel):
    project: ProjectProfile
    founder: Person
    comparables: list[Comparable]
    team: list[TeamMember] = Field(default_factory=list)
    contacts: list[DeclaredContact] = Field(default_factory=list)
    affiliations: list[Affiliation] = Field(default_factory=list)
    exclude_funds: list[str] = Field(default_factory=list)  # fondos a omitir (conflictos, ya descartados)
    filters: Filters = Field(default_factory=Filters)
    weights: Weights = Field(default_factory=Weights)
    top_n: int = 20
    hop_penalty: float = 0.25
    max_hops: int = 4

    @field_validator("comparables")
    @classmethod
    def _five(cls, v: list[Comparable]) -> list[Comparable]:
        if not 1 <= len(v) <= 10:
            raise ValueError("Se esperan entre 1 y 10 comparables (idealmente 5).")
        return v

    @classmethod
    def load(cls, path: str | Path) -> "Config":
        with open(path, encoding="utf-8") as f:
            return cls.model_validate(yaml.safe_load(f))


class RoundInvestor(BaseModel):
    name: str
    lead: bool = False
    person: str = ""  # partner que lideró, si la fuente lo dice
    domain: str = ""


class Round(BaseModel):
    """Una ronda de un comparable. SIEMPRE con cita: sin source_url + snippet no entra."""
    company: str
    date: date
    stage: Stage = "unknown"
    amount_usd: float | None = None
    investors: list[RoundInvestor]
    source_url: str
    snippet: str  # fragmento literal de la fuente que respalda la lista de inversores
    confidence: float = 0.9

    @model_validator(mode="after")
    def _cited(self) -> "Round":
        if not self.source_url.startswith("http"):
            raise ValueError(f"Ronda de {self.company}: source_url debe ser una URL.")
        if len(self.snippet.strip()) < 10:
            raise ValueError(f"Ronda de {self.company}: falta el fragmento citado (snippet).")
        return self


class RoundsFile(BaseModel):
    rounds: list[Round] = Field(default_factory=list)

    @classmethod
    def load(cls, path: str | Path) -> "RoundsFile":
        with open(path, encoding="utf-8") as f:
            return cls.model_validate(yaml.safe_load(f) or {})
