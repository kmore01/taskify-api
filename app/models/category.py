from pydantic import BaseModel


class Task(BaseModel):
    id: str | None
    title: str
    description: str
    # Task
