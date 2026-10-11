from datetime import datetime

from pydantic import BaseModel


class Task(BaseModel):
    id: str | None
    title: str
    description: str
    date: datetime
    deadline: datetime


class TaskPage(BaseModel):
    items: list[Task]
    total: int
    page: int
    page_size: int
