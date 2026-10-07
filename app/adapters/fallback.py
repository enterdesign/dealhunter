"""Sklep bez adaptera: tylko cena z JSON-LD (niezweryfikowana koszykiem)."""
from ..models import Candidate, Destination
from ..pricing import extract_jsonld_offer
from .base import Adapter, CheckResult


class JsonLdFallback(Adapter):
    name = "json-ld (bez koszyka)"

    async def check(self, page, cand: Candidate, dest: Destination) -> CheckResult:
        await page.goto(cand.url, timeout=15000)
        blocks = await page.eval_on_selector_all(
            'script[type="application/ld+json"]', "els => els.map(e => e.textContent)"
        )
        offer = extract_jsonld_offer(blocks)
        res = CheckResult(note="Brak adaptera sklepu – cena z danych strony, bez kodu i dostawy.")
        if "price" in offer:
            res.item_price = res.total_no_code = res.total_final = offer["price"]
            res.currency = offer.get("currency", "")
        else:
            res.note = "Brak adaptera i brak ceny w danych strony."
        return res
