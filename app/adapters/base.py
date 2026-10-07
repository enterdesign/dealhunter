from dataclasses import dataclass, field
from typing import Optional

from ..models import Candidate, Destination


@dataclass
class CheckResult:
    item_price: Optional[float] = None
    shipping: Optional[float] = None
    total_no_code: Optional[float] = None
    total_final: Optional[float] = None
    currency: str = ""
    code_used: Optional[str] = None
    codes_tried: dict = field(default_factory=dict)
    verified: bool = False
    note: str = ""


class Adapter:
    """Interfejs adaptera sklepu: sprawdza koszyk dla jednego kandydata."""

    name = "base"

    async def check(self, page, cand: Candidate, dest: Destination) -> CheckResult:
        raise NotImplementedError
