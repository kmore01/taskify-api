"""API tests over an in-memory database (see fake_db.py).

Run from the repo root: JWT_SECRET=x venv/bin/python -m unittest discover -s tests
"""
import os
import re
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ.setdefault("JWT_SECRET", "test-secret")

from fake_db import FakeClient  # noqa: E402

with patch("motor.motor_asyncio.AsyncIOMotorClient", FakeClient):
    from app.main import app  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.db.database import db  # noqa: E402
from app.routers import auth  # noqa: E402

PASSWORD = "correct-horse"


def iso(days=0, hours=0):
    return (datetime.utcnow() + timedelta(days=days, hours=hours)).isoformat()


def event(title="Dentista", **extra):
    return {"title": title, "start": iso(days=1), "end": iso(days=1, hours=1), **extra}


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.client.__enter__()  # runs the lifespan (indexes)

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)

    def setUp(self):
        db.users.docs.clear()
        db.events.docs.clear()
        auth.ATTEMPTS.clear()

    def register(self, name="ana", password=PASSWORD):
        return self.client.post(
            "/auth/register",
            json={"username": name, "email": f"{name}@example.com", "password": password},
        )

    def login(self, name="ana", password=PASSWORD):
        return self.client.post("/auth/login", data={"username": name, "password": password})

    def user(self, name="ana"):
        """Register and log in; returns the Authorization headers."""
        self.assertEqual(self.register(name).status_code, 201)
        return {"Authorization": f"Bearer {self.login(name).json()['access_token']}"}

    # --- auth ---------------------------------------------------------------

    def test_register_login_and_me(self):
        me = self.client.get("/auth/users/me", headers=self.user())
        self.assertEqual(me.json()["username"], "ana")
        self.assertEqual(me.json()["email"], "ana@example.com")

    def test_register_validates_password_email_and_duplicates(self):
        self.assertEqual(self.register(password="short").status_code, 422)
        bad_email = self.client.post(
            "/auth/register",
            json={"username": "ana", "email": "not-an-email", "password": PASSWORD},
        )
        self.assertEqual(bad_email.status_code, 422)
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(self.register().status_code, 409)

    def test_login_is_rate_limited(self):
        self.register()
        for _ in range(8):
            self.assertEqual(self.login(password="wrong-password").status_code, 401)
        blocked = self.login()  # even the right password waits now
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("Retry-After", blocked.headers)

    def test_successful_login_clears_the_attempt_count(self):
        self.register()
        for _ in range(3):
            for _ in range(5):
                self.login(password="wrong-password")
            self.assertEqual(self.login().status_code, 200)

    def test_refresh_returns_a_working_token(self):
        fresh = self.client.post("/auth/refresh", headers=self.user()).json()["access_token"]
        me = self.client.get("/auth/users/me", headers={"Authorization": f"Bearer {fresh}"})
        self.assertEqual(me.status_code, 200)

    def test_change_password_ends_older_sessions(self):
        old = self.user()
        body = {"current_password": "wrong-password", "new_password": "another-horse"}
        self.assertEqual(self.client.post("/auth/password", json=body, headers=old).status_code, 403)
        body["current_password"] = PASSWORD
        changed = self.client.post("/auth/password", json=body, headers=old)
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(self.client.get("/auth/users/me", headers=old).status_code, 401)
        new = {"Authorization": f"Bearer {changed.json()['access_token']}"}
        self.assertEqual(self.client.get("/auth/users/me", headers=new).status_code, 200)
        self.assertEqual(self.login().status_code, 401)
        self.assertEqual(self.login(password="another-horse").status_code, 200)

    def test_password_reset_link_works_once(self):
        session = self.user()
        with patch("app.routers.auth.send_mail") as send_mail:
            unknown = self.client.post("/auth/forgot", json={"email": "nobody@example.com"})
            self.assertEqual(unknown.status_code, 204)
            send_mail.assert_not_called()
            self.assertEqual(
                self.client.post("/auth/forgot", json={"email": "ANA@example.com"}).status_code, 204
            )
        to, _subject, body = send_mail.call_args.args
        self.assertEqual(to, "ana@example.com")
        token = re.search(r"\?reset=(\S+)", body)[1]

        # A session token is not a reset token, and the other way round.
        session_token = session["Authorization"].split()[1]
        as_reset = {"token": session_token, "new_password": "another-horse"}
        self.assertEqual(self.client.post("/auth/reset", json=as_reset).status_code, 400)
        as_session = {"Authorization": f"Bearer {token}"}
        self.assertEqual(self.client.get("/auth/users/me", headers=as_session).status_code, 401)

        reset = {"token": token, "new_password": "another-horse"}
        self.assertEqual(self.client.post("/auth/reset", json=reset).status_code, 204)
        self.assertEqual(self.login(password="another-horse").status_code, 200)
        self.assertEqual(self.client.get("/auth/users/me", headers=session).status_code, 401)
        self.assertEqual(self.client.post("/auth/reset", json=reset).status_code, 400)

    def test_delete_account_removes_user_and_events(self):
        ana, luis = self.user(), self.user("luis")
        self.client.post("/events/", json=event(), headers=ana)
        self.client.post("/events/", json=event(), headers=luis)
        wrong = self.client.request(
            "DELETE", "/auth/users/me", json={"password": "wrong-password"}, headers=ana
        )
        self.assertEqual(wrong.status_code, 403)
        gone = self.client.request(
            "DELETE", "/auth/users/me", json={"password": PASSWORD}, headers=ana
        )
        self.assertEqual(gone.status_code, 204)
        self.assertEqual(self.login().status_code, 401)
        self.assertEqual(len(db.events.docs), 1)  # only Luis's event is left
        self.assertEqual(self.client.get("/events/", headers=luis).json()["total"], 1)

    def test_username_is_normalized_before_validation(self):
        self.assertEqual(self.register("   ").status_code, 422)  # not a 3-character name
        spaced = {"username": " Ana ", "email": "ana@example.com", "password": PASSWORD}
        self.assertEqual(self.client.post("/auth/register", json=spaced).status_code, 201)
        self.assertEqual(self.login("ana").status_code, 200)

    def test_registration_and_password_guessing_are_rate_limited(self):
        statuses = [self.register(f"user{i}").status_code for i in range(11)]
        self.assertEqual(statuses, [201] * 10 + [429])
        auth.ATTEMPTS.clear()
        session = {"Authorization": f"Bearer {self.login('user0').json()['access_token']}"}
        guess = {"password": "wrong-password"}
        tries = [
            self.client.request("DELETE", "/auth/users/me", json=guess, headers=session).status_code
            for _ in range(9)
        ]
        self.assertEqual(tries, [403] * 8 + [429])

    def test_responses_carry_security_headers(self):
        page = self.client.get("/static/index.html")
        self.assertIn("default-src 'self'", page.headers["Content-Security-Policy"])
        self.assertEqual(page.headers["X-Frame-Options"], "DENY")
        self.assertEqual(self.client.get("/events/").headers["X-Content-Type-Options"], "nosniff")
        root = self.client.get("/", follow_redirects=False)
        self.assertEqual(root.headers["location"], "/static/index.html")

    # --- events -------------------------------------------------------------

    def test_oversized_and_empty_input_is_rejected(self):
        ana = self.user()
        for extra in ({"title": "   "}, {"title": "a" * 121}, {"description": "a" * 5001},
                      {"category": "a" * 41}, {"color": "a" * 21}):
            status = self.client.post("/events/", json={**event(), **extra}, headers=ana).status_code
            self.assertEqual(status, 422, extra.keys())
        huge = self.client.post("/events/", json=event(description="a" * 2_100_000), headers=ana)
        self.assertEqual(huge.status_code, 413)
        self.assertEqual(db.events.docs, [])

    def test_events_stored_before_the_limits_can_still_be_read(self):
        ana = self.user()
        id = self.client.post("/events/", json=event(), headers=ana).json()["id"]
        db.events.docs[0]["description"] = "a" * 9000  # e.g. an old .ics import
        self.assertEqual(self.client.get("/events/", headers=ana).status_code, 200)
        self.assertEqual(len(self.client.get(f"/events/{id}", headers=ana).json()["description"]), 9000)

    def test_ics_import_is_capped_and_round_trips(self):
        ana = self.user()
        # Whole seconds: .ics has no finer resolution, and the UI never sends one.
        weekly = {"title": "Clase", "start": "2026-11-13T17:00:00", "end": "2026-11-13T19:00:00"}
        self.client.post("/events/", json={**weekly, "repeat": "weekly"}, headers=ana)
        exported = self.client.get("/events/export.ics", headers=ana)
        self.assertIn("RRULE:FREQ=WEEKLY", exported.text)
        calendar = {**ana, "Content-Type": "text/calendar"}
        again = self.client.post("/events/import", content=exported.content, headers=calendar)
        self.assertEqual((again.json()["imported"], again.json()["skipped"]), (0, 1))
        big = b"BEGIN:VCALENDAR\r\n" + b"X" * 1_000_100
        self.assertEqual(self.client.post("/events/import", content=big, headers=calendar).status_code, 400)


    def test_events_require_a_token(self):
        self.assertEqual(self.client.get("/events/").status_code, 401)
        self.assertEqual(self.client.post("/events/", json=event()).status_code, 401)

    def test_create_read_update_delete(self):
        ana = self.user()
        created = self.client.post("/events/", json=event(color="sage"), headers=ana)
        self.assertEqual(created.status_code, 201)
        id = created.json()["id"]
        self.assertEqual(self.client.get(f"/events/{id}", headers=ana).json()["title"], "Dentista")

        # Fields the client leaves out keep their value.
        body = {**event("Dentista (revisión)"), "id": id}
        updated = self.client.put("/events/", json=body, headers=ana).json()
        self.assertEqual((updated["title"], updated["color"]), ("Dentista (revisión)", "sage"))

        self.assertEqual(self.client.delete(f"/events/{id}", headers=ana).status_code, 204)
        self.assertEqual(self.client.get(f"/events/{id}", headers=ana).status_code, 404)

    def test_titles_may_repeat(self):
        ana = self.user()
        for _ in range(2):
            self.assertEqual(self.client.post("/events/", json=event(), headers=ana).status_code, 201)
        self.assertEqual(self.client.get("/events/", headers=ana).json()["total"], 2)

    def test_users_only_reach_their_own_events(self):
        ana, luis = self.user(), self.user("luis")
        id = self.client.post("/events/", json=event(), headers=ana).json()["id"]
        self.assertEqual(self.client.get("/events/", headers=luis).json()["items"], [])
        self.assertEqual(self.client.get(f"/events/{id}", headers=luis).status_code, 404)
        stolen = self.client.put("/events/", json={**event("Mío"), "id": id}, headers=luis)
        self.assertEqual(stolen.status_code, 404)
        self.assertEqual(self.client.delete(f"/events/{id}", headers=luis).status_code, 404)
        self.assertEqual(self.client.get(f"/events/{id}", headers=ana).json()["title"], "Dentista")

    def test_range_returns_overlaps_and_earlier_series(self):
        ana = self.user()
        def add(title, start, end, **extra):
            body = {"title": title, "start": start, "end": end, **extra}
            self.client.post("/events/", json=body, headers=ana)
        add("antes", "2026-01-01T10:00:00", "2026-01-01T11:00:00")
        add("dentro", "2026-03-10T10:00:00", "2026-03-10T11:00:00")
        add("cruza", "2026-02-27T10:00:00", "2026-03-02T11:00:00")
        add("despues", "2026-05-01T10:00:00", "2026-05-01T11:00:00")
        add("serie", "2026-01-05T10:00:00", "2026-01-05T11:00:00", repeat="weekly")
        add("serie futura", "2026-06-01T10:00:00", "2026-06-01T11:00:00", repeat="weekly")
        page = self.client.get(
            "/events/", params={"start": "2026-03-01", "end": "2026-03-31"}, headers=ana
        ).json()
        self.assertEqual({e["title"] for e in page["items"]}, {"dentro", "cruza", "serie"})
        self.assertEqual(page["total"], 3)

    def test_finished_event_is_completed(self):
        ana = self.user()
        past = {"title": "ayer", "start": iso(days=-1), "end": iso(days=-1, hours=1)}
        self.assertTrue(self.client.post("/events/", json=past, headers=ana).json()["completed"])
        self.assertFalse(self.client.post("/events/", json=event(), headers=ana).json()["completed"])

    def test_end_before_start_is_rejected(self):
        body = {"title": "al revés", "start": iso(days=2), "end": iso(days=1)}
        self.assertEqual(self.client.post("/events/", json=body, headers=self.user()).status_code, 400)

    def test_series_end_exceptions_and_reminder_round_trip(self):
        ana = self.user()
        body = event(
            repeat="weekly",
            repeat_until="2027-01-31T22:59:59.999Z",
            exceptions=["2026-12-24T09:00:00+01:00"],
            reminder=15,
        )
        created = self.client.post("/events/", json=body, headers=ana).json()
        # Stored and returned as naive UTC, like every other datetime.
        self.assertEqual(created["repeat_until"], "2027-01-31T22:59:59.999000")
        self.assertEqual(created["exceptions"], ["2026-12-24T08:00:00"])
        self.assertEqual(created["reminder"], 15)

        skipped = {**body, "id": created["id"], "exceptions": []}
        self.assertEqual(self.client.put("/events/", json=skipped, headers=ana).json()["exceptions"], [])
        negative = self.client.post("/events/", json=event(reminder=-5), headers=ana)
        self.assertEqual(negative.status_code, 422)


if __name__ == "__main__":
    unittest.main()
