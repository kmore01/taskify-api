from datetime import datetime

from pydantic import BaseModel


class Task(BaseModel):
    id: str | None
    title: str
    description: str
    date: datetime
    deadline: datetime
