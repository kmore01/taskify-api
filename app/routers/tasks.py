### Tasks API ###

# CRUD:
# - Create --> Post
# - Read --> Get
# - Update --> Put
# - Delete --> Delete.

from datetime import date, datetime, time, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query

from app.db.database import db
from app.deps import get_current_user
from app.models.error import ErrorResponse
from app.models.task import Task, TaskCompletion, TaskPage
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


def to_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def validate_dates(start: datetime, end: datetime) -> None:
    if end < start:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                error="End date must be after start date"
            ).model_dump(),
        )


def parse_date_bound(value: str, *, end_of_day: bool) -> datetime:
    raw = value.strip()
    try:
        if len(raw) == 10:
            day = date.fromisoformat(raw)
            return datetime.combine(day, time.max if end_of_day else time.min)
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                error="Invalid date range. Use ISO 8601 or YYYY-MM-DD."
            ).model_dump(),
        )
    return to_utc_naive(parsed)


@router.post("/", response_model=Task, status_code=201)
async def create_task(task: Task, user=Depends(get_current_user)):
    if await task_exists("title", task.title, user["_id"]) is not None:
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(error="Task already exists").model_dump(),
        )
    task_dict = task.model_dump()
    del task_dict["id"]  # MongoDB will create the id
    task_dict["date"] = to_utc_naive(task_dict["date"])
    task_dict["deadline"] = to_utc_naive(task_dict["deadline"])
    validate_dates(task_dict["date"], task_dict["deadline"])
    if task_dict["completed"]:
        task_dict["completed_at"] = task_dict["completed_at"] or utc_now()
    else:
        task_dict["completed_at"] = None
    task_dict["owner"] = user["_id"]  # Task belongs to the authenticated user
    id = (await db.tasks.insert_one(task_dict)).inserted_id
    new_task = task_schema(await db.tasks.find_one({"_id": id}))
    return Task(**new_task)


@router.get("/", response_model=TaskPage)
async def list_tasks(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    start: str | None = None,
    end: str | None = None,
    user=Depends(get_current_user),
):
    # Paginated listing for the current user. An optional [start, end] range
    # returns only tasks that overlap it (used by the calendar).
    owner = user["_id"]
    query: dict = {"owner": owner}
    if start is not None:
        query["deadline"] = {"$gte": parse_date_bound(start, end_of_day=False)}
    if end is not None:
        query["date"] = {"$lte": parse_date_bound(end, end_of_day=True)}

    tasks = (
        await db.tasks.find(query)
        .sort([("date", 1), ("deadline", 1)])
        .skip(skip)
        .limit(limit)
        .to_list(length=None)
    )
    total = await db.tasks.count_documents(query)
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
    existing = await db.tasks.find_one({"_id": obj_id, "owner": user["_id"]})
    if existing is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(error="Task does not exists").model_dump(),
        )

    # Only touch the fields the client sent so older clients do not wipe
    # calendar metadata (color, completed, category...).
    changes = task.model_dump(exclude_unset=True, exclude={"id"})
    for key in ("date", "deadline", "completed_at"):
        if changes.get(key) is not None:
            changes[key] = to_utc_naive(changes[key])

    validate_dates(
        changes.get("date", existing["date"]),
        changes.get("deadline", existing["deadline"]),
    )
    if "completed" in changes:
        if changes["completed"]:
            if not changes.get("completed_at"):
                changes["completed_at"] = utc_now()
        else:
            changes["completed_at"] = None

    if changes:
        await db.tasks.update_one(
            {"_id": obj_id, "owner": user["_id"]}, {"$set": changes}
        )
    return await task_exists("_id", obj_id, user["_id"])


@router.patch("/{id}/completed", response_model=Task)
async def set_task_completed(
    id: str, payload: TaskCompletion, user=Depends(get_current_user)
):
    obj_id = parse_object_id(id)
    result = await db.tasks.update_one(
        {"_id": obj_id, "owner": user["_id"]},
        {
            "$set": {
                "completed": payload.completed,
                "completed_at": utc_now() if payload.completed else None,
            }
        },
    )
    if result.matched_count == 0:
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
