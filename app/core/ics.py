"""Minimal iCalendar (.ics) reader and writer for the fields Planifier stores.

Datetimes in Mongo are naive UTC. `tz` is the user's IANA zone: it localizes
all-day events and floating times, which carry no zone of their own.
"""

import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

FREQ = {"DAILY": "daily", "WEEKLY": "weekly", "MONTHLY": "monthly", "YEARLY": "yearly"}
RRULE = {v: k for k, v in FREQ.items()}
MAX_EVENTS = 1000


def zone(name: str | None, fallback: ZoneInfo | None = None) -> ZoneInfo:
    try:
        return ZoneInfo(name) if name else fallback or ZoneInfo("UTC")
    except Exception:
        return fallback or ZoneInfo("UTC")


# --- writer -----------------------------------------------------------------


def _escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> str:
    # Lines are limited to 75 octets; continuation lines start with a space.
    out, current, size = [], "", 0
    for ch in line:
        n = len(ch.encode())
        if size + n > 75:
            out.append(current)
            current, size = " ", 1
        current += ch
        size += n
    out.append(current)
    return "\r\n".join(out)


def _utc(value: datetime) -> str:
    return value.strftime("%Y%m%dT%H%M%SZ")


def build_ics(events: list[dict], tz: str = "UTC") -> str:
    local = zone(tz)
    stamp = _utc(datetime.now(UTC))
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Planifier//ES",
        "CALSCALE:GREGORIAN",
    ]
    for e in events:
        start, end = e["start"], e["end"]
        lines += ["BEGIN:VEVENT", f"UID:{e['_id']}@planifier", f"DTSTAMP:{stamp}"]
        if e.get("all_day"):
            first = start.replace(tzinfo=UTC).astimezone(local).date()
            last = end.replace(tzinfo=UTC).astimezone(local).date() + timedelta(days=1)
            lines += [
                f"DTSTART;VALUE=DATE:{first:%Y%m%d}",
                f"DTEND;VALUE=DATE:{last:%Y%m%d}",
            ]
        else:
            lines += [f"DTSTART:{_utc(start)}", f"DTEND:{_utc(end)}"]
        lines.append(f"SUMMARY:{_escape(e['title'])}")
        if e.get("description"):
            lines.append(f"DESCRIPTION:{_escape(e['description'])}")
        if e.get("location"):
            lines.append(f"LOCATION:{_escape(e['location'])}")
        if e.get("link"):
            lines.append(f"URL:{e['link']}")
        if e.get("category"):
            lines.append(f"CATEGORIES:{_escape(e['category'])}")
        if e.get("repeat") in RRULE:
            # All-day series use DATE values, so UNTIL and EXDATE must be dates too.
            def stamp_of(value: datetime) -> str:
                if e.get("all_day"):
                    return f"{value.replace(tzinfo=UTC).astimezone(local):%Y%m%d}"
                return _utc(value)

            rule = f"RRULE:FREQ={RRULE[e['repeat']]}"
            if e.get("repeat_until"):
                rule += f";UNTIL={stamp_of(e['repeat_until'])}"
            lines.append(rule)
            kind = ";VALUE=DATE" if e.get("all_day") else ""
            lines += [f"EXDATE{kind}:{stamp_of(x)}" for x in e.get("exceptions") or []]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


# --- reader -----------------------------------------------------------------


def _unescape(text: str) -> str:
    return re.sub(r"\\([nN,;\\])", lambda m: "\n" if m[1] in "nN" else m[1], text)


def _unfold(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        elif raw:
            lines.append(raw)
    return lines


def _split(line: str):
    head, _, value = line.partition(":")
    name, *raw_params = head.split(";")
    params = {}
    for p in raw_params:
        key, _, val = p.partition("=")
        params[key.upper()] = val.strip('"')
    return name.upper(), params, value


def _moment(value: str, params: dict, local: ZoneInfo):
    """Return (naive UTC datetime, is_date_only)."""
    value = value.strip()
    if params.get("VALUE") == "DATE" or len(value) == 8:
        day = datetime.strptime(value[:8], "%Y%m%d")
        return day.replace(tzinfo=local).astimezone(UTC).replace(tzinfo=None), True
    moment = datetime.strptime(value.rstrip("Z"), "%Y%m%dT%H%M%S")
    zone_ = UTC if value.endswith("Z") else zone(params.get("TZID"), local)
    return moment.replace(tzinfo=zone_).astimezone(UTC).replace(tzinfo=None), False


def _event(props: dict, local: ZoneInfo):
    """Build one event dict from VEVENT properties; (event, simplified)."""
    title = _unescape(props["SUMMARY"][1]).strip()[:120]
    if not title:
        raise ValueError("empty title")
    start, all_day = _moment(props["DTSTART"][1], props["DTSTART"][0], local)
    if "DTEND" in props:
        end, _ = _moment(props["DTEND"][1], props["DTEND"][0], local)
        # All-day DTEND is exclusive; the app stores the last millisecond of the day.
        end = end - timedelta(milliseconds=1) if all_day else end
    else:
        end = start + (timedelta(days=1, milliseconds=-1) if all_day else timedelta(hours=1))
    if end < start:
        raise ValueError("end before start")

    repeat, simplified, until, exceptions = "none", False, None, []
    if "RRULE" in props:
        parts = dict(p.split("=", 1) for p in props["RRULE"][1].split(";") if "=" in p)
        extra = set(parts) - {"FREQ", "INTERVAL", "UNTIL"}
        if parts.get("FREQ") in FREQ and not extra and parts.get("INTERVAL", "1") == "1":
            repeat = FREQ[parts["FREQ"]]
            if "UNTIL" in parts:
                until, date_only = _moment(parts["UNTIL"], {}, local)
                if date_only:  # a date includes that whole day
                    until += timedelta(days=1, milliseconds=-1)
            exceptions = [
                _moment(value, params, local)[0]
                for params, values in props.get("EXDATE", [])
                for value in values.split(",")
                if value.strip()
            ]
        else:
            simplified = True  # interval, weekdays, count... are not supported

    link = props.get("URL", ("", ""))[1].strip()
    category = _unescape(props.get("CATEGORIES", ("", ""))[1]).split(",")[0].strip()
    return {
        "title": title,
        "description": _unescape(props.get("DESCRIPTION", ("", ""))[1]).strip()[:5000],
        "start": start,
        "end": end,
        "all_day": all_day,
        "color": None,
        "category": category[:40] or None,
        "location": _unescape(props.get("LOCATION", ("", ""))[1]).strip()[:120] or None,
        "link": link[:500] if link.lower().startswith(("http://", "https://")) else None,
        "repeat": repeat,
        "repeat_until": until,
        "exceptions": exceptions,
        "reminder": 0,
    }, simplified


def parse_ics(text: str, tz: str = "UTC") -> dict:
    """Return {"events": [...], "simplified": n, "invalid": n}."""
    local = zone(tz)
    events, simplified, invalid = [], 0, 0
    props: dict | None = None
    in_alarm = False  # a VALARM has its own DESCRIPTION we must not read
    for line in _unfold(text):
        name, params, value = _split(line)
        if name in ("BEGIN", "END") and value.upper() == "VALARM":
            in_alarm = name == "BEGIN"
        elif in_alarm:
            continue
        elif name == "BEGIN" and value.upper() == "VEVENT":
            props = {}
        elif name == "END" and value.upper() == "VEVENT" and props is not None:
            try:
                event, was_simplified = _event(props, local)
                events.append(event)
                simplified += was_simplified
            except (KeyError, ValueError):
                invalid += 1
            props = None
        elif props is not None and name == "EXDATE":
            props.setdefault(name, []).append((params, value))  # may repeat
        elif props is not None and name not in props:
            props[name] = (params, value)
    return {"events": events, "simplified": simplified, "invalid": invalid}
