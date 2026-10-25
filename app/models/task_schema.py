# Task -> JSON
def task_schema(task) -> dict:
    return {
        "id": str(task["_id"]),
        "title": task["title"],
        "description": task.get("description") or "",
        "date": task["date"],
        "deadline": task["deadline"],
        "all_day": bool(task.get("all_day", False)),
        "completed": bool(task.get("completed", False)),
        "completed_at": task.get("completed_at"),
        "color": task.get("color"),
        "category": task.get("category"),
    }


def tasks_schema(tasks) -> list:
    return [task_schema(t) for t in tasks]
