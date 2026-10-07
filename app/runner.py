import asyncio
import os
import uuid

from playwright.async_api import async_playwright

from .adapters.configured import ConfiguredAdapter, find_shop
from .adapters.fallback import JsonLdFallback
from .models import Candidate, CandidateResult, Destination, Job, JobRequest
from .security import url_allowed

JOBS: dict[str, Job] = {}
MAX_CANDIDATES = 15
CONCURRENCY = 3
_sem = asyncio.Semaphore(CONCURRENCY)


def create_job(req: JobRequest) -> Job:
    req.candidates = req.candidates[:MAX_CANDIDATES]
    job = Job(id=uuid.uuid4().hex[:12], request=req)
    job.results = [CandidateResult(shop=c.shop or c.url, url=c.url) for c in req.candidates]
    JOBS[job.id] = job
    return job


async def _check_one(browser, cand: Candidate, dest: Destination, out: CandidateResult) -> None:
    ok, why = url_allowed(cand.url)
    if not ok:
        out.status, out.note = "error", why
        return
    cfg = find_shop(cand.url)
    adapter = ConfiguredAdapter(cfg) if cfg else JsonLdFallback()
    out.adapter, out.status = adapter.name, "running"
    async with _sem:
        ctx = await browser.new_context(locale="en-IE")
        page = await ctx.new_page()
        try:
            r = await asyncio.wait_for(adapter.check(page, cand, dest), timeout=60)
            out.item_price, out.shipping = r.item_price, r.shipping
            out.total_no_code, out.total_final = r.total_no_code, r.total_final
            out.currency, out.code_used, out.codes_tried = r.currency, r.code_used, r.codes_tried
            out.note = r.note
            if r.total_final is None:
                out.status = "error"
            else:
                out.status = "verified" if r.verified else "unverified"
        except Exception as e:  # noqa: BLE001
            out.status, out.note = "error", f"{type(e).__name__}: {str(e)[:160]}"
        finally:
            await ctx.close()


async def run_job(job: Job) -> None:
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                executable_path=os.environ.get("CHROMIUM_PATH") or None,
            )
            try:
                await asyncio.gather(*(
                    _check_one(browser, c, job.request.destination, r)
                    for c, r in zip(job.request.candidates, job.results)
                ))
            finally:
                await browser.close()
    finally:
        job.status = "done"
