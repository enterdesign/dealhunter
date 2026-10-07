import json
import re
from typing import Optional

_NUM = re.compile(r"\d[\d\s .,]*")
_CURRENCIES = (
    ("€", "EUR"), ("EUR", "EUR"), ("zł", "PLN"), ("PLN", "PLN"),
    ("£", "GBP"), ("GBP", "GBP"), ("$", "USD"), ("USD", "USD"),
)


def parse_price(text: str) -> Optional[float]:
    """'€1,234.50' / '1 234,50 zł' / '12.99' -> float. None gdy brak liczby."""
    if not text:
        return None
    m = _NUM.search(text)
    if not m:
        return None
    s = m.group(0).strip().replace(" ", "").replace(" ", "").rstrip(".,")
    if not s:
        return None
    last_dot, last_comma = s.rfind("."), s.rfind(",")
    if last_dot != -1 and last_comma != -1:
        dec = "." if last_dot > last_comma else ","
    elif last_dot != -1 or last_comma != -1:
        sep = "." if last_dot != -1 else ","
        pos = s.rfind(sep)
        digits_after = len(s) - pos - 1
        # jedyny separator: dziesiętny, jeśli 1-2 cyfry po nim i występuje raz
        dec = sep if digits_after in (1, 2) and s.count(sep) == 1 else None
    else:
        dec = None
    if dec:
        whole, frac = s.rsplit(dec, 1)
        whole = re.sub(r"[.,]", "", whole)
        s = f"{whole}.{frac}"
    else:
        s = re.sub(r"[.,]", "", s)
    try:
        return float(s)
    except ValueError:
        return None


def detect_currency(text: str) -> str:
    for sym, code in _CURRENCIES:
        if sym in (text or ""):
            return code
    return ""


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def extract_jsonld_offer(blocks: list[str]) -> dict:
    """Z bloków JSON-LD wyciąga {price, currency, gtin} pierwszego Product/Offer."""
    out: dict = {}
    for raw in blocks:
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        for node in _walk(data):
            for key in ("gtin13", "gtin", "gtin14", "gtin12", "gtin8"):
                if key in node and "gtin" not in out:
                    out["gtin"] = str(node[key])
            if "price" in node and "price" not in out:
                p = parse_price(str(node["price"]))
                if p is not None:
                    out["price"] = p
                    out["currency"] = node.get("priceCurrency", "")
            elif "lowPrice" in node and "price" not in out:
                p = parse_price(str(node["lowPrice"]))
                if p is not None:
                    out["price"] = p
                    out["currency"] = node.get("priceCurrency", "")
    return out
