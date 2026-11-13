from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Event(BaseModel):
    id: str | None = None
    title: str
    description: str = ""
    start: datetime
    end: datetime
    all_day: bool = False
    # Read-only: true once the event has ended. Whatever a client sends is ignored.
    completed: bool = False
    color: str | None = None
    category: str | None = None
    location: str | None = Field(default=None, max_length=120)
    link: str | None = Field(default=None, max_length=500)
    repeat: Literal["none", "daily", "weekly", "monthly", "yearly"] = "none"


    @field_validator("location", "link")
    @classmethod
    def blank_to_none(cls, value):
        return (value or "").strip() or None

    @field_validator("link")
    @classmethod
    def http_only(cls, value):
        # Only web links: anything else (javascript:, data:) would be rendered as an href.
        if value is not None and not value.lower().startswith(("http://", "https://")):
            raise ValueError("link must start with http:// or https://")
        return value



class EventPage(BaseModel):
    items: list[Event]
    total: int
    page: int
    page_size: int
