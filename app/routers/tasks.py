### Tasks API ###

# CRUD:
# - Create --> Post
# - Read --> Get
# - Update --> Put
# - Delete --> Delete.

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from app.db.database import db
from app.deps import get_current_user
from app.models.error import ErrorResponse
from app.models.task import Task, TaskPage
from app.models.task_schema import task_schema, tasks_schema

router = APIRouter(
    prefix="/tasks", tags=["tasks"], responses={404: {"message": "Not found"}}
)

# await waits until an async subroutine finishes

# Every route requires auth and each task stores its owner, so users only
# see and modify their own tasks.


def parse_object_id(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error="Invalid task ID format").model_dump(),
        )


@router.post("/", response_model=Task, status_code=201)
async def create_task(task: Task, user=Depends(get_current_user)):
    if await task_exists("title", task.title, user["_id"]) is not None:
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(error="Task already exists").model_dump(),
        )
    task_dict = dict(task)
    del task_dict["id"]  # MongoDB will create the id
    task_dict["owner"] = user["_id"]  # Task belongs to the authenticated user
    id = (await db.tasks.insert_one(task_dict)).inserted_id
    new_task = task_schema(await db.tasks.find_one({"_id": id}))
    return Task(**new_task)


@router.get("/", response_model=TaskPage)
async def list_tasks(skip: int = 0, limit: int = 100, user=Depends(get_current_user)):
    # Paginated listing for the current user
    owner = user["_id"]
    tasks = (
        await db.tasks.find({"owner": owner})
        .skip(skip)
        .limit(limit)
        .to_list(length=None)
    )
    total = await db.tasks.count_documents({"owner": owner})
    return {
        "items": tasks_schema(tasks),
        "total": total,
        "page": skip // limit + 1,
        "page_size": limit,
    }


@router.get("/{id}", response_model=Task)  # Detail by path parameter
async def get_task(id: str, user=Depends(get_current_user)):
    obj_id = parse_object_id(id)
    task = await task_exists("_id", obj_id, user["_id"])
    if not task:
        raise HTTPException(
            status_code=404, detail=ErrorResponse(error="Task not found").model_dump()
        )
    return task


# @router.get("/")  # Query
# async def task_id2(id: str):
#    return await task_exists("_id", ObjectId(id))


@router.put("/", response_model=Task)
async def update_task(task: Task, user=Depends(get_current_user)):
    if not task.id:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error="Task ID is required").model_dump(),
        )
    obj_id = parse_object_id(task.id)
    task_dict = dict(task)
    del task_dict["id"]  # MongoDB id cannot chnage
    task_dict["owner"] = user["_id"]  # Keep the owner
    replaced = await db.tasks.find_one_and_replace(
        {"_id": obj_id, "owner": user["_id"]}, task_dict
    )
    if replaced is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(error="Task does not exists").model_dump(),
        )
    return await task_exists("_id", obj_id, user["_id"])


@router.delete("/{id}", status_code=204)
async def delete_task(id: str, user=Depends(get_current_user)):
    obj_id = parse_object_id(id)
    found = await db.tasks.find_one_and_delete({"_id": obj_id, "owner": user["_id"]})
    if not found:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(error="Task does not exists").model_dump(),
        )


async def task_exists(field: str, key, user_id):
    if field == "_id":
        task = await db.tasks.find_one({"_id": key, "owner": user_id})
    else:
        task = await db.tasks.find_one({field: key, "owner": user_id})
    if task is None:
        return None
    return task_schema(task)
