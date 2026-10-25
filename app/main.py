# Official documentation: https://fastapi.tiangolo.com/es/

# Download FastAPI: pip install "fastapi[all]"

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db.database import db
from app.routers import auth, categories, tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("username", unique=True)
    await db.users.create_index("email", unique=True)
    await db.tasks.create_index([("owner", 1), ("date", 1)])
    await db.tasks.create_index([("owner", 1), ("deadline", 1)])
    yield


app = FastAPI(lifespan=lifespan)

app.include_router(tasks.router)
app.include_router(categories.router)
app.include_router(auth.router)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Local url: http://127.0.0.1:8000


@app.get("/")
async def root():
    return "Hello FastAPI!"


# Start the server: uvicorn app.main:app --reload
# Swagger documentation: http://127.0.0.1:8000/docs
# Redocly documentación: http://127.0.0.1:8000/redoc
