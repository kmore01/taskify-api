from app.models.error import ErrorResponse

# Task -> JSON
def task_schema(task) -> dict:
    return {
        "id": str(task["_id"]),
        "title": task["title"],
        "description": task["description"],
        "date": task["date"],
        "deadline": task["deadline"],
    }


def tasks_schema(tasks) -> list:
    return [task_schema(t) for t in tasks]
