import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .adapters.configured import load_shops
from .demo_shop import router as demo_router
from .models import JobRequest
from .runner import JOBS, create_job, run_job

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="DealHunter")
app.include_router(demo_router)
_tasks: set[asyncio.Task] = set()


@app.post("/api/jobs")
async def post_job(req: JobRequest):
    if not req.candidates:
        raise HTTPException(400, "Podaj co najmniej jednego kandydata (sklep + link).")
    job = create_job(req)
    task = asyncio.create_task(run_job(job))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"id": job.id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Nie ma takiego zadania.")
    return job


@app.get("/api/shops")
def shops():
    return [{"name": s["name"], "match": s["url_contains"]} for s in load_shops()]


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
