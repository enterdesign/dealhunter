"""Adapter sterowany konfiguracją (app/shops.json): selektory zamiast kodu per sklep."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from ..models import Candidate, Destination
from ..pricing import detect_currency, parse_price
from .base import Adapter, CheckResult

SHOPS_FILE = Path(__file__).resolve().parent.parent / "shops.json"
TIMEOUT = 8000


def load_shops() -> list[dict]:
    return json.loads(SHOPS_FILE.read_text(encoding="utf-8"))


def find_shop(url: str) -> Optional[dict]:
    for shop in load_shops():
        if shop["url_contains"] in url:
            return shop
    return None


class ConfiguredAdapter(Adapter):
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.name = cfg["name"]

    async def _text(self, page, key: str) -> Optional[str]:
        sel = self.cfg.get(key)
        if not sel:
            return None
        loc = page.locator(sel).first
        try:
            await loc.wait_for(state="visible", timeout=TIMEOUT)
            return (await loc.inner_text()).strip()
        except Exception:
            return None

    async def _read_totals(self, page) -> tuple[Optional[float], Optional[float], Optional[float], str]:
        sub = await self._text(page, "subtotal")
        ship = await self._text(page, "shipping")
        total = await self._text(page, "total")
        cur = detect_currency(total or sub or "")
        return parse_price(sub or ""), parse_price(ship or ""), parse_price(total or ""), cur

    async def _apply_postcode(self, page, dest: Destination) -> None:
        if dest.postcode and self.cfg.get("postcode_input"):
            await page.fill(self.cfg["postcode_input"], dest.postcode, timeout=TIMEOUT)
            if self.cfg.get("postcode_apply"):
                await page.click(self.cfg["postcode_apply"], timeout=TIMEOUT)
                await page.wait_for_load_state("networkidle", timeout=TIMEOUT)

    async def check(self, page, cand: Candidate, dest: Destination) -> CheckResult:
        res = CheckResult()
        await page.goto(cand.url, timeout=15000)
        await page.click(self.cfg["add_to_cart"], timeout=TIMEOUT)
        await page.wait_for_load_state("networkidle", timeout=TIMEOUT)
        if self.cfg.get("cart_url"):
            await page.goto(self.cfg["cart_url"], timeout=15000)

        await self._apply_postcode(page, dest)
        sub, ship, total, cur = await self._read_totals(page)
        if total is None:
            res.note = "Nie udało się odczytać sumy koszyka (selektor?)."
            return res
        res.item_price, res.shipping, res.currency = sub, ship, cur
        res.total_no_code = res.total_final = total
        res.verified = True  # cena bazowa potwierdzona koszykiem

        best = total
        for code in cand.codes:
            try:
                await page.fill(self.cfg["code_input"], code, timeout=TIMEOUT)
                await page.click(self.cfg["code_apply"], timeout=TIMEOUT)
                await page.wait_for_load_state("networkidle", timeout=TIMEOUT)
                _, ship2, new_total, _ = await self._read_totals(page)
            except Exception as e:  # noqa: BLE001
                res.codes_tried[code] = f"błąd: {type(e).__name__}"
                continue
            if new_total is not None and new_total < total - 0.005:
                res.codes_tried[code] = f"działa: {new_total:.2f}"
                if new_total < best:
                    best, res.code_used, res.shipping = new_total, code, ship2 if ship2 is not None else res.shipping
            else:
                err = await self._text(page, "code_error")
                res.codes_tried[code] = f"nie działa{': ' + err if err else ''}"
        res.total_final = best
        return res

