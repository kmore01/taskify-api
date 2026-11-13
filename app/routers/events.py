from datetime import date, datetime, time, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pymongo import ReturnDocument

from app.core.ics import MAX_EVENTS, build_ics, parse_ics
from app.db.database import db
from app.deps import get_current_user
from app.models.error import ErrorResponse
from app.models.event import Event, EventPage
from app.models.event_schema import event_schema, events_schema

router = APIRouter(
    prefix="/events", tags=["events"], responses={404: {"message": "Not found"}}
)

# Every route requires auth and each event stores its owner, so users only
# see and modify their own events.


def parse_object_id(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error="Invalid event ID format").model_dump(),
        )


def to_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


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


@router.post("/", response_model=Event, status_code=201)
async def create_event(event: Event, user=Depends(get_current_user)):
    if (
        await db.events.find_one(
            {"title": event.title, "owner": user["_id"]}, {"_id": 1}
        )
        is not None
    ):
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(error="Event already exists").model_dump(),
        )
    event_dict = event.model_dump(exclude={"id", "completed"})
    event_dict["start"] = to_utc_naive(event_dict["start"])
    event_dict["end"] = to_utc_naive(event_dict["end"])
    validate_dates(event_dict["start"], event_dict["end"])
    event_dict["owner"] = user["_id"]
    id = (await db.events.insert_one(event_dict)).inserted_id
    return Event(**event_schema({**event_dict, "_id": id}))


@router.get("/", response_model=EventPage)
async def list_events(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    start: str | None = None,
    end: str | None = None,
    user=Depends(get_current_user),
):
    # Paginated listing for the current user. An optional [start, end] range
    # returns only events that overlap it (used by the calendar).
    owner = user["_id"]
    query: dict = {"owner": owner}
    overlap: dict = {}
    if start is not None:
        overlap["end"] = {"$gte": parse_date_bound(start, end_of_day=False)}
    if end is not None:
        overlap["start"] = {"$lte": parse_date_bound(end, end_of_day=True)}
    if overlap:
        # Recurring series are expanded by the client, so return every series
        # that began before the range ends, wherever its first occurrence is.
        series: dict = {"repeat": {"$in": ["daily", "weekly", "monthly", "yearly"]}}
        if "start" in overlap:
            series["start"] = overlap["start"]
        query["$or"] = [overlap, series]

    events = (
        await db.events.find(query)
        .sort([("start", 1), ("end", 1)])
        .skip(skip)
        .limit(limit)
        .to_list(length=None)
    )
    total = await db.events.count_documents(query)
    return {
        "items": events_schema(events),
        "total": total,
        "page": skip // limit + 1,
        "page_size": limit,
    }


# Declared before "/{id}" so "categories" is not parsed as a event id.
@router.get("/categories", response_model=list[str])
async def list_categories(user=Depends(get_current_user)):
    values = await db.events.distinct("category", {"owner": user["_id"]})
    return sorted({v for v in values if v}, key=str.casefold)


# Declared before "/{id}" so "export.ics" is not parsed as an event id.
@router.get("/export.ics")
async def export_events(tz: str = "UTC", user=Depends(get_current_user)):
    docs = await db.events.find({"owner": user["_id"]}).sort("start", 1).to_list(None)
    return Response(
        build_ics(docs, tz),
        media_type="text/calendar",
        headers={"Content-Disposition": 'attachment; filename="planifier.ics"'},
    )


@router.post("/import")
async def import_events(
    request: Request, tz: str = "UTC", user=Depends(get_current_user)
):
    # The body is the raw .ics text. Events already present (same title and
    # start) are skipped, so importing the same file twice is harmless.
    raw = await request.body()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = ""
    if len(raw) > 1_000_000 or "BEGIN:VCALENDAR" not in text.upper():
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error="Not a valid .ics file").model_dump(),
        )
    parsed = parse_ics(text, tz)
    if len(parsed["events"]) > MAX_EVENTS:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                error=f"Too many events (max {MAX_EVENTS})"
            ).model_dump(),
        )

    owner, fresh, skipped = user["_id"], [], 0
    seen: set = set()
    for event in parsed["events"]:
        key = (event["title"], event["start"])
        if key in seen or await db.events.find_one(
            {"owner": owner, "title": event["title"], "start": event["start"]},
            {"_id": 1},
        ):
            skipped += 1
            continue
        seen.add(key)
        fresh.append({**event, "owner": owner})
    if fresh:
        await db.events.insert_many(fresh)
    return {
        "imported": len(fresh),
        "skipped": skipped,
        "simplified": parsed["simplified"],
        "invalid": parsed["invalid"],
    }


@router.get("/{id}", response_model=Event)
async def get_event(id: str, user=Depends(get_current_user)):
    obj_id = parse_object_id(id)
    event = await event_exists("_id", obj_id, user["_id"])
    if not event:
        raise HTTPException(
            status_code=404, detail=ErrorResponse(error="Event not found").model_dump()
        )
    return event


@router.put("/", response_model=Event)
async def update_event(event: Event, user=Depends(get_current_user)):
    if not event.id:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error="Event ID is required").model_dump(),
        )
    obj_id = parse_object_id(event.id)
    existing = await db.events.find_one({"_id": obj_id, "owner": user["_id"]})
    if existing is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(error="Event does not exist").model_dump(),
        )

    # Only touch the fields the client sent so older clients do not wipe
    # calendar metadata (color, category...).
    changes = event.model_dump(exclude_unset=True, exclude={"id", "completed"})
    for key in ("start", "end"):
        if changes.get(key) is not None:
            changes[key] = to_utc_naive(changes[key])

    validate_dates(
        changes.get("start", existing["start"]),
        changes.get("end", existing["end"]),
    )
    if not changes:
        return Event(**event_schema(existing))

    updated = await db.events.find_one_and_update(
        {"_id": obj_id, "owner": user["_id"]},
        {"$set": changes},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(error="Event does not exist").model_dump(),
        )
    return Event(**event_schema(updated))


@router.delete("/{id}", status_code=204)
async def delete_event(id: str, user=Depends(get_current_user)):
    obj_id = parse_object_id(id)
    found = await db.events.find_one_and_delete({"_id": obj_id, "owner": user["_id"]})
    if not found:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(error="Event does not exist").model_dump(),
        )


async def event_exists(field: str, key, user_id):
    event = await db.events.find_one({field: key, "owner": user_id})
    return event_schema(event) if event is not None else None
