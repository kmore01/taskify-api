from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db.database import db
from app.routers import auth, tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("username", unique=True)
    await db.users.create_index("email", unique=True)
    await db.tasks.create_index([("owner", 1), ("date", 1)])
    await db.tasks.create_index([("owner", 1), ("deadline", 1)])
    # Supports the duplicate-title check without failing on existing duplicates.
    await db.tasks.create_index([("owner", 1), ("title", 1)])
    yield


app = FastAPI(lifespan=lifespan)

app.include_router(tasks.router)
app.include_router(auth.router)
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/")
async def root():
    return "Hello FastAPI!"
