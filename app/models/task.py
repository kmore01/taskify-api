from datetime import datetime

from pydantic import BaseModel


class Task(BaseModel):
    id: str | None = None
    title: str
    description: str = ""
    date: datetime
    deadline: datetime
    all_day: bool = False
    completed: bool = False
    completed_at: datetime | None = None
    color: str | None = None
    category: str | None = None


class TaskCompletion(BaseModel):
    completed: bool


class TaskPage(BaseModel):
    items: list[Task]
    total: int
    page: int
    page_size: int
