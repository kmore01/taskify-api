from datetime import datetime
from typing import Literal

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator


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
    # Last moment a series may start an occurrence; None repeats forever.
    repeat_until: datetime | None = None
    # Original start of each occurrence removed from the series ("only this one").
    exceptions: list[datetime] = Field(default_factory=list, max_length=1000)
    # Minutes before `start` the browser reminder fires; 0 means at the start.
    reminder: int = Field(default=0, ge=0, le=40320)


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



class EventIn(Event):
    """What clients may send. The limits live here, not on `Event`, so events
    stored before they existed can still be read."""

    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
    ]
    description: str = Field(default="", max_length=5000)
    color: str | None = Field(default=None, max_length=20)
    category: str | None = Field(default=None, max_length=40)


class EventPage(BaseModel):
    items: list[Event]
    total: int
    page: int
    page_size: int
