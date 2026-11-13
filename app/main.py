from contextlib import asynccontextmanager

from fastapi import FastAPI
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
    # Supports the duplicate-title check without failing on existing duplicates.
    await db.events.create_index([("owner", 1), ("title", 1)])
    yield


app = FastAPI(lifespan=lifespan)

app.include_router(events.router)
app.include_router(auth.router)
app.mount("/static", StaticFiles(directory="app/static"), name="static")


# No build step means no hashed filenames, so make browsers revalidate static
# files (cheap 304s) instead of running a stale ES module after an edit.
@app.middleware("http")
async def revalidate_static(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/")
async def root():
    return "Hello FastAPI!"
