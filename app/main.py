from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.db.database import db
from app.routers import auth, events


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("username", unique=True)
    await db.users.create_index("email", unique=True)
    # date/deadline became start/end and manual completion was removed.
    await db.events.update_many(
        {"date": {"$exists": True}},
        {
            "$rename": {"date": "start", "deadline": "end"},
            "$unset": {"completed": "", "completed_at": ""},
        },
    )
    await db.events.create_index([("owner", 1), ("start", 1)])
    await db.events.create_index([("owner", 1), ("end", 1)])
    # Serves the list sorted by title and the .ics import's duplicate check.
    await db.events.create_index([("owner", 1), ("title", 1)])
    yield


app = FastAPI(lifespan=lifespan)

app.include_router(events.router)
app.include_router(auth.router)
app.mount("/static", StaticFiles(directory="app/static"), name="static")


# The frontend loads only its own files plus the Google Fonts stylesheet, so a
# strict policy costs nothing and keeps injected markup from running script
# (the session token lives in localStorage).
STATIC_CSP = (
    "default-src 'self'; "
    "style-src 'self' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; "
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)
# Largest legitimate body is a 1 MB .ics import.
MAX_BODY_BYTES = 2_000_000


@app.middleware("http")
async def harden(request, call_next):
    # shortcut: only bodies that declare their size are refused here; put a
    # reverse proxy with its own body limit in front for chunked uploads.
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return JSONResponse(
            {"detail": {"error": "Request body too large", "detail": None}},
            status_code=413,
        )
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith("/static/"):
        # No build step means no hashed filenames, so make browsers revalidate
        # static files (cheap 304s) instead of running a stale ES module.
        response.headers["Cache-Control"] = "no-cache"
        response.headers["Content-Security-Policy"] = STATIC_CSP
    return response


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse("/static/index.html")
