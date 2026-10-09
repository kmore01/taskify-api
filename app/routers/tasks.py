### Tasks API ###

# CRUD:
# - Create --> Post
# - Read --> Get
# - Update --> Put
# - Delete --> Delete

from bson import ObjectId
from fastapi import APIRouter, HTTPException

from app.db.database import db
from app.db.schemas.task import task_schema, tasks_schema
from app.models.task import Task

router = APIRouter(
    prefix="/tasks", tags=["tasks"], responses={404: {"message": "Not found"}}
)

# await wait until an async subroutine finishes


@router.post("/", response_model=Task, status_code=201)
async def task(task: Task):
    if await task_exists("title", task.title) is not None:
        raise HTTPException(status_code=409, detail="Task already exists")
    task_dict = dict(task)
    del task_dict["id"]  # MongoDB will create the id
    id = (await db.tasks.insert_one(task_dict)).inserted_id
    new_task = task_schema(await db.tasks.find_one({"_id": id}))
    return Task(**new_task)


@router.get("/", response_model=list[Task])
async def tasks():
    return tasks_schema(await db.tasks.find().to_list(length=None))


@router.get("/{id}")  # Path
async def task_id(id: str):
    return await task_exists("_id", ObjectId(id))


@router.get("/")  # Query
async def task_id2(id: str):
    return await task_exists("_id", ObjectId(id))


@router.put("/", response_model=Task)
async def update_task(task: Task):
    task_dict = dict(task)
    del task_dict["id"]  # MongoDB id cannot chnage
    try:
        await db.tasks.find_one_and_replace({"_id": ObjectId(task.id)}, task_dict)
    except:
        raise HTTPException(status_code=404, detail="Task doesnt exists")
    return await task_exists("_id", ObjectId(task.id))


@router.delete("/{id}", status_code=204)
async def delete_task(id: str):
    found = db.tasks.find_one_and_delete({"_id": ObjectId(id)})
    if not found:
        raise HTTPException(status_code=404, detail="Task doesnt exists")


async def task_exists(field: str, key):
    task = await db.tasks.find_one({field: key})
    if task is None:
        return None
    return task_schema(task)
