"""Run from the repo root: venv/bin/python -m unittest discover -s tests"""
import unittest
from datetime import datetime

from app.core.ics import build_ics, parse_ics


def ev(**extra):
    return {
        "_id": "abc",
        "title": "Reunión",
        "description": "",
        "start": datetime(2026, 11, 13, 10),
        "end": datetime(2026, 11, 13, 11),
        "all_day": False,
        **extra,
    }


def wrap(body):
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{body}END:VCALENDAR\r\n"


def vevent(*lines):
    return "BEGIN:VEVENT\r\n" + "".join(f"{x}\r\n" for x in lines) + "END:VEVENT\r\n"


class SeriesEndAndExceptionsTest(unittest.TestCase):
    def test_until_and_exdates_survive_export_then_import(self):
        src = ev(
            repeat="weekly",
            repeat_until=datetime(2026, 12, 31, 22, 59, 59),
            exceptions=[datetime(2026, 11, 20, 10), datetime(2026, 11, 27, 10)],
        )
        text = build_ics([src])
        self.assertIn("RRULE:FREQ=WEEKLY;UNTIL=20261231T225959Z", text)
        self.assertIn("EXDATE:20261120T100000Z", text)
        got = parse_ics(text)["events"][0]
        self.assertEqual(got["repeat"], "weekly")
        self.assertEqual(got["repeat_until"], src["repeat_until"])
        self.assertEqual(got["exceptions"], src["exceptions"])

    def test_all_day_series_uses_local_dates(self):
        src = ev(
            start=datetime(2026, 11, 12, 23),  # Nov 13 00:00 in Madrid
            end=datetime(2026, 11, 13, 22, 59, 59, 999000),
            all_day=True,
            repeat="daily",
            repeat_until=datetime(2026, 11, 20, 22, 59, 59, 999000),
            exceptions=[datetime(2026, 11, 14, 23)],
        )
        text = build_ics([src], "Europe/Madrid")
        self.assertIn("RRULE:FREQ=DAILY;UNTIL=20261120", text)
        self.assertIn("EXDATE;VALUE=DATE:20261115", text)
        got = parse_ics(text, "Europe/Madrid")["events"][0]
        self.assertEqual(got["repeat_until"], src["repeat_until"])
        self.assertEqual(got["exceptions"], src["exceptions"])

    def test_comma_separated_and_repeated_exdate_lines_are_read(self):
        text = wrap(
            vevent(
                "SUMMARY:Clase",
                "DTSTART:20261113T100000Z",
                "DTEND:20261113T110000Z",
                "RRULE:FREQ=DAILY",
                "EXDATE:20261114T100000Z,20261115T100000Z",
                "EXDATE:20261116T100000Z",
            )
        )
        got = parse_ics(text)["events"][0]
        self.assertEqual([x.day for x in got["exceptions"]], [14, 15, 16])

    def test_plain_events_carry_empty_defaults(self):
        got = parse_ics(build_ics([ev()]))["events"][0]
        self.assertEqual((got["repeat_until"], got["exceptions"], got["reminder"]), (None, [], 0))


class RoundTripTest(unittest.TestCase):
    def test_all_fields_survive_export_then_import(self):
        src = ev(
            description="Línea 1\nLínea 2, con; símbolos \\",
            location="Sala 2",
            link="https://x.org/a?b=1",
            category="Trabajo",
            repeat="weekly",
        )
        out = parse_ics(build_ics([src]))
        self.assertEqual((out["invalid"], out["simplified"]), (0, 0))
        got = out["events"][0]
        for key in ("title", "description", "start", "end", "location", "link",
                    "category", "repeat", "all_day"):
            self.assertEqual(got[key], src[key], key)

    def test_long_lines_are_folded_to_75_octets_and_unfolded_on_import(self):
        title = "Ñandú " * 40
        text = build_ics([ev(title=title)])
        self.assertTrue(all(len(line.encode()) <= 75 for line in text.split("\r\n")))
        self.assertEqual(parse_ics(text)["events"][0]["title"], title.strip()[:120])

    def test_all_day_uses_the_user_timezone_and_exclusive_end(self):
        # Madrid is UTC+1 in November: local midnight is 23:00 UTC the day before.
        src = ev(
            all_day=True,
            start=datetime(2026, 11, 12, 23),
            end=datetime(2026, 11, 13, 22, 59, 59, 999000),
        )
        text = build_ics([src], "Europe/Madrid")
        self.assertIn("DTSTART;VALUE=DATE:20261113", text)
        self.assertIn("DTEND;VALUE=DATE:20261114", text)
        got = parse_ics(text, "Europe/Madrid")["events"][0]
        self.assertEqual((got["start"], got["end"]), (src["start"], src["end"]))
        self.assertTrue(got["all_day"])


class ImportTest(unittest.TestCase):
    def test_timezone_and_floating_times_are_converted_to_utc(self):
        text = wrap(
            vevent("SUMMARY:A", "DTSTART;TZID=America/New_York:20261113T090000",
                   "DTEND;TZID=America/New_York:20261113T100000")
            + vevent("SUMMARY:B", "DTSTART:20261113T090000", "DTEND:20261113T100000")
        )
        a, b = parse_ics(text, "Europe/Madrid")["events"]
        self.assertEqual(a["start"], datetime(2026, 11, 13, 14))
        self.assertEqual(b["start"], datetime(2026, 11, 13, 8))  # floating = user's zone

    def test_missing_end_defaults(self):
        text = wrap(vevent("SUMMARY:A", "DTSTART:20261113T090000Z")
                    + vevent("SUMMARY:B", "DTSTART;VALUE=DATE:20261113"))
        a, b = parse_ics(text)["events"]
        self.assertEqual((a["end"] - a["start"]).seconds, 3600)
        self.assertEqual(b["end"], datetime(2026, 11, 13, 23, 59, 59, 999000))

    def test_simple_rrule_is_kept_and_complex_ones_are_simplified(self):
        base = ("SUMMARY:A", "DTSTART:20261113T090000Z", "DTEND:20261113T100000Z")
        text = wrap(
            vevent(*base, "RRULE:FREQ=MONTHLY")
            + vevent(*base, "RRULE:FREQ=WEEKLY;INTERVAL=2")
            + vevent(*base, "RRULE:FREQ=WEEKLY;BYDAY=MO,WE")
            + vevent(*base, "RRULE:FREQ=DAILY;COUNT=3")
        )
        out = parse_ics(text)
        self.assertEqual([e["repeat"] for e in out["events"]], ["monthly", "none", "none", "none"])
        self.assertEqual(out["simplified"], 3)

    def test_invalid_events_are_counted_and_do_not_stop_the_import(self):
        text = wrap(
            vevent("DTSTART:20261113T090000Z")  # no summary
            + vevent("SUMMARY:Bad", "DTSTART:garbage")
            + vevent("SUMMARY:Backwards", "DTSTART:20261113T100000Z", "DTEND:20261113T090000Z")
            + vevent("SUMMARY:Good", "DTSTART:20261113T090000Z", "DTEND:20261113T100000Z")
        )
        out = parse_ics(text)
        self.assertEqual([e["title"] for e in out["events"]], ["Good"])
        self.assertEqual(out["invalid"], 3)

    def test_unsafe_links_are_dropped(self):
        text = wrap(vevent("SUMMARY:A", "DTSTART:20261113T090000Z", "DTEND:20261113T100000Z",
                           "URL:javascript:alert(1)"))
        self.assertIsNone(parse_ics(text)["events"][0]["link"])

    def test_alarm_description_is_not_used_as_the_event_description(self):
        text = wrap(
            "BEGIN:VEVENT\r\nSUMMARY:A\r\nDTSTART:20261113T090000Z\r\nDTEND:20261113T100000Z\r\n"
            "BEGIN:VALARM\r\nDESCRIPTION:ring\r\nEND:VALARM\r\nEND:VEVENT\r\n"
        )
        self.assertEqual(parse_ics(text)["events"][0]["description"], "")

    def test_title_and_location_are_truncated_to_the_form_limits(self):
        text = wrap(vevent("SUMMARY:" + "x" * 300, "LOCATION:" + "y" * 300,
                           "DTSTART:20261113T090000Z", "DTEND:20261113T100000Z"))
        e = parse_ics(text)["events"][0]
        self.assertEqual((len(e["title"]), len(e["location"])), (120, 120))

    def test_unknown_timezone_falls_back_to_utc(self):
        text = wrap(vevent("SUMMARY:A", "DTSTART:20261113T090000", "DTEND:20261113T100000"))
        self.assertEqual(parse_ics(text, "Not/AZone")["events"][0]["start"], datetime(2026, 11, 13, 9))


if __name__ == "__main__":
    unittest.main()
