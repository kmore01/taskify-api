"""Run from the repo root: venv/bin/python -m unittest discover -s tests"""
import unittest
from datetime import datetime, timedelta

from pydantic import ValidationError

from app.models.event import Event
from app.models.event_schema import event_schema


def doc(hours_from_now, **extra):
    end = datetime.utcnow() + timedelta(hours=hours_from_now)
    return {"_id": 1, "title": "t", "start": end - timedelta(hours=1), "end": end, **extra}


class EventSchemaTest(unittest.TestCase):
    def test_old_documents_default_to_no_repeat(self):
        self.assertEqual(event_schema(doc(5))["repeat"], "none")

    def test_repeat_is_returned(self):
        self.assertEqual(event_schema(doc(5, repeat="weekly"))["repeat"], "weekly")

    def test_past_plain_event_is_completed(self):
        out = event_schema(doc(-2))
        self.assertTrue(out["completed"])

    def test_future_plain_event_is_pending(self):
        self.assertFalse(event_schema(doc(5))["completed"])

    def test_stored_completed_flag_is_ignored(self):
        self.assertFalse(event_schema(doc(5, completed=True))["completed"])

    def test_client_cannot_set_completed(self):
        now = datetime.utcnow()
        e = Event(title="t", start=now, end=now, completed=True)
        self.assertNotIn("completed", e.model_dump(exclude={"id", "completed"}))

    def test_past_series_is_not_completed(self):
        # The client decides per occurrence, so a series never completes as a whole.
        self.assertFalse(event_schema(doc(-2, repeat="daily"))["completed"])


class EventModelTest(unittest.TestCase):
    def test_repeat_defaults_to_none(self):
        now = datetime.utcnow()
        self.assertEqual(Event(title="t", start=now, end=now).repeat, "none")

    def test_accepts_every_frequency_and_rejects_others(self):
        now = datetime.utcnow()
        for value in ("none", "daily", "weekly", "monthly", "yearly"):
            Event(title="t", start=now, end=now, repeat=value)
        with self.assertRaises(ValidationError):
            Event(title="t", start=now, end=now, repeat="hourly")

    def test_location_and_link_are_optional_and_blank_becomes_none(self):
        now = datetime.utcnow()
        e = Event(title="t", start=now, end=now)
        self.assertEqual((e.location, e.link), (None, None))
        e = Event(title="t", start=now, end=now, location="  ", link="")
        self.assertEqual((e.location, e.link), (None, None))
        e = Event(title="t", start=now, end=now, location=" Sala 2 ", link="https://x.org/a")
        self.assertEqual((e.location, e.link), ("Sala 2", "https://x.org/a"))

    def test_link_must_be_http_or_https(self):
        now = datetime.utcnow()
        for bad in ("javascript:alert(1)", "data:text/html,x", "ftp://x.org", "x.org"):
            with self.assertRaises(ValidationError):
                Event(title="t", start=now, end=now, link=bad)

    def test_schema_returns_location_and_link(self):
        out = event_schema(doc(5, location="Sala", link="https://x.org"))
        self.assertEqual((out["location"], out["link"]), ("Sala", "https://x.org"))
        self.assertEqual((event_schema(doc(5))["location"], event_schema(doc(5))["link"]), (None, None))


if __name__ == "__main__":
    unittest.main()
