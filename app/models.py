from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class Destination(BaseModel):
    country: str = "IE"
    postcode: str = ""
    city: str = ""


class Candidate(BaseModel):
    shop: str = ""
    url: str
    codes: list[str] = Field(default_factory=list)
    source: str = ""  # skąd kod/oferta (np. "Pepper", "newsletter")


class JobRequest(BaseModel):
    ean: str = ""
    product_url: str = ""
    destination: Destination = Field(default_factory=Destination)
    candidates: list[Candidate]


class CandidateResult(BaseModel):
    shop: str
    url: str
    status: str = "pending"  # pending | running | verified | unverified | error
    adapter: str = ""
    item_price: Optional[float] = None
    shipping: Optional[float] = None
    total_no_code: Optional[float] = None
    total_final: Optional[float] = None
    currency: str = ""
    code_used: Optional[str] = None
    codes_tried: dict[str, str] = Field(default_factory=dict)  # kod -> wynik
    note: str = ""


class Job(BaseModel):
    id: str
    status: str = "running"  # running | done
    request: JobRequest
    results: list[CandidateResult] = Field(default_factory=list)
