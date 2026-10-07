"""Pełny przepływ: uvicorn + Playwright na sklepach demo."""
import socket
import threading
import time

import httpx
import pytest
import uvicorn

from app.main import app


@pytest.fixture(scope="module")
def base():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    while not server.started:
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    t.join(5)


def run(base, candidates):
    r = httpx.post(f"{base}/api/jobs", json={"destination": {"postcode": "D02 X285"}, "candidates": candidates})
    r.raise_for_status()
    jid = r.json()["id"]
    for _ in range(90):
        job = httpx.get(f"{base}/api/jobs/{jid}").json()
        if job["status"] == "done":
            return job["results"]
        time.sleep(0.5)
    raise AssertionError("timeout")


def test_demo_shops(base):
    res = run(base, [
        {"shop": "A", "url": f"{base}/demo-shop/a/product", "codes": ["BADCODE", "SAVE10"]},
        {"shop": "B", "url": f"{base}/demo-shop/b/product", "codes": ["WELCOME5"]},
    ])
    a, b = res
    assert a["status"] == "verified" and b["status"] == "verified"
    assert (a["item_price"], a["shipping"], a["total_no_code"]) == (49.90, 4.99, 54.89)
    assert a["code_used"] == "SAVE10" and a["total_final"] == 49.90
    assert a["codes_tried"]["BADCODE"].startswith("nie działa")
    assert b["code_used"] == "WELCOME5" and b["total_final"] == 47.00


def test_fallback_and_blocked(base):
    res = run(base, [
        {"shop": "nieznany", "url": f"{base}/demo-shop/c/product"},  # 404 -> błąd/brak ceny
        {"shop": "ssrf", "url": "http://169.254.169.254/latest/meta-data"},
    ])
    assert res[1]["status"] == "error" and "prywatny" in res[1]["note"].lower()
    assert res[0]["status"] == "error"
