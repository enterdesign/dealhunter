import pytest

from app.pricing import extract_jsonld_offer, parse_price


@pytest.mark.parametrize("text,expected", [
    ("€1,234.50", 1234.50), ("1 234,50 zł", 1234.50), ("12.99", 12.99),
    ("€49", 49.0), ("-€5.00", 5.0), ("1.234", 1234.0), ("", None), ("free", None),
])
def test_parse_price(text, expected):
    assert parse_price(text) == expected


def test_jsonld():
    blk = '{"@type":"Product","gtin13":"123","offers":{"price":"9,99","priceCurrency":"EUR"}}'
    assert extract_jsonld_offer([blk]) == {"gtin": "123", "price": 9.99, "currency": "EUR"}
    assert extract_jsonld_offer(["not json"]) == {}
