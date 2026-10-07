"""Sklep demo do testów end-to-end (bez dostępu do prawdziwych sklepów)."""
import json
from html import escape

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="/demo-shop")

SHOPS = {
    "a": {"name": "Demo Shop A", "price": 49.90, "shipping": 4.99,
          "codes": {"SAVE10": ("pct", 10)}},
    "b": {"name": "Demo Shop B", "price": 52.00, "shipping": 0.0,
          "codes": {"WELCOME5": ("flat", 5.0)}},
}
EAN = "5901234123457"


@router.get("/{sid}/product", response_class=HTMLResponse)
def product(sid: str):
    s = SHOPS[sid]
    ld = {"@context": "https://schema.org", "@type": "Product", "name": "Słuchawki Demo",
          "gtin13": EAN, "offers": {"@type": "Offer", "price": s["price"], "priceCurrency": "EUR"}}
    return f"""<!doctype html><html><head><meta charset=utf-8><title>{s['name']}</title>
<script type="application/ld+json">{json.dumps(ld)}</script></head><body>
<h1>Słuchawki Demo</h1><p id="price">€{s['price']:.2f}</p>
<a id="add-to-cart" href="cart">Add to cart</a></body></html>"""


@router.get("/{sid}/cart", response_class=HTMLResponse)
def cart(sid: str, postcode: str = "", code: str = ""):
    s = SHOPS[sid]
    sub = s["price"]
    discount, msg = 0.0, ""
    if code:
        rule = s["codes"].get(code.strip().upper())
        if rule:
            kind, val = rule
            discount = round(sub * val / 100, 2) if kind == "pct" else val
            msg = '<p class="promo-ok">Code applied</p>'
        else:
            msg = '<p class="promo-error">Invalid code</p>'
    total = sub - discount + s["shipping"]
    pc, cd = escape(postcode, True), escape(code, True)
    return f"""<!doctype html><html><head><meta charset=utf-8><title>Cart</title></head><body>
<h1>Cart – {s['name']}</h1>
<form method=get><input id="postcode" name="postcode" value="{pc}">
<input type=hidden name="code" value="{cd}"><button id="postcode-apply">Update</button></form>
<form method=get><input id="promo-code" name="code" value="{cd}">
<input type=hidden name="postcode" value="{pc}"><button id="promo-apply">Apply</button></form>
{msg}
<p>Subtotal: <span id="subtotal">€{sub:.2f}</span></p>
<p>Discount: <span id="discount">-€{discount:.2f}</span></p>
<p>Shipping: <span id="shipping">€{s['shipping']:.2f}</span></p>
<p>Total: <span id="total">€{total:.2f}</span></p></body></html>"""
