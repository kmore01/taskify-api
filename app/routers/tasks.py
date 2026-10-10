### Tasks API ###

# CRUD:
# - Create --> Post
# - Read --> Get
# - Update --> Put
# - Delete --> Delete.

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, HTTPException

from app.db.database import db
from app.db.schemas.task import ErrorResponse, task_schema, tasks_schema
from app.models.task import Task

router = APIRouter(
    prefix="/tasks", tags=["tasks"], responses={404: {"message": "Not found"}}
)

# await waits until an async subroutine finishes


@router.post("/", response_model=Task, status_code=201)
async def create_task(task: Task):
    if await task_exists("title", task.title) is not None:
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(error="Task already exists").model_dump(),
        )
    task_dict = dict(task)
    del task_dict["id"]  # MongoDB will create the id
    id = (await db.tasks.insert_one(task_dict)).inserted_id
    new_task = task_schema(await db.tasks.find_one({"_id": id}))
    return Task(**new_task)


@router.get("/", response_model=list[Task])
async def list_tasks():
    # Returns at most 100 tasks
    return tasks_schema(await db.tasks.find().limit(100).to_list(length=100))


@router.get("/{id}", response_model=Task)  # Detail by path parameter
async def get_task(id: str):
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error="Invalid task ID format").model_dump(),
        )
    task = await task_exists("_id", obj_id)
    if not task:
        raise HTTPException(
            status_code=404, detail=ErrorResponse(error="Task not found").model_dump()
        )
    return task


# @router.get("/")  # Query
# async def task_id2(id: str):
#    return await task_exists("_id", ObjectId(id))


@router.put("/", response_model=Task)
async def update_task(task: Task):
    if not task.id:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error="Task ID is required").model_dump(),
        )
    try:
        obj_id = ObjectId(task.id)
    except InvalidId:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error="Invalid task ID format").model_dump(),
        )
    task_dict = dict(task)
    del task_dict["id"]  # MongoDB id cannot chnage
    try:
        await db.tasks.find_one_and_replace({"_id": obj_id}, task_dict)
    except Exception:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(error="Task does not exists").model_dump(),
        )
    return await task_exists("_id", obj_id)


@router.delete("/{id}", status_code=204)
async def delete_task(id: str):
    try:
        obj_id = ObjectId(id)
    except InvalidId:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error="Invalid task ID format").model_dump(),
        )
    found = await db.tasks.find_one_and_delete({"_id": obj_id})
    if not found:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(error="Task does not exists").model_dump(),
        )


async def task_exists(field: str, key):
    try:
        obj_key = ObjectId(key) if field == "_id" else key
    except InvalidId:
        return None
    task = await db.tasks.find_one({field: obj_key if field == "_id" else key})
    if task is None:
        return None
    return task_schema(task)
