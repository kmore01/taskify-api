from datetime import datetime


def event_schema(event) -> dict:
    # An event that has already ended counts as completed (naive UTC, like Mongo).
    repeat = event.get("repeat") or "none"
    # A series never ends as a whole: the client decides per occurrence.
    ended = repeat == "none" and event["end"] <= datetime.utcnow()
    return {
        "id": str(event["_id"]),
        "title": event["title"],
        "description": event.get("description") or "",
        "start": event["start"],
        "end": event["end"],
        "all_day": bool(event.get("all_day", False)),
        "completed": ended,
        "color": event.get("color"),
        "category": event.get("category"),
        "location": event.get("location"),
        "link": event.get("link"),
        "repeat": repeat,
        "repeat_until": event.get("repeat_until"),
        "exceptions": event.get("exceptions") or [],
        "reminder": event.get("reminder") or 0,
    }


def events_schema(events) -> list:
    return [event_schema(t) for t in events]
