// Run: node --test tests/*.test.mjs   (also try TZ=Europe/Madrid to cover DST)
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { expand, seriesBody, seriesId } from "../app/static/recurrence.js";

// Local-time helpers keep the tests independent of the machine's timezone.
const local = (y, m, d, h = 9, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const ymd = (iso) => {
  const d = new Date(iso);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-");
};
const series = (repeat, y, m, d, h = 9, hours = 1) => ({
  id: "abc",
  repeat,
  start: local(y, m, d, h),
  end: local(y, m, d, h + hours),
});
const days = (events, start, end) => expand(events, start, end).map((o) => ymd(o.start));

// "Now" is fixed to 2026-11-13 12:00 local.
const freeze = () => mock.timers.enable({ apis: ["Date"], now: new Date(2026, 10, 13, 12) });

test("a non-recurring event is returned untouched", () => {
  const e = { ...series("none", 2026, 10, 1), completed: false };
  assert.deepEqual(expand(e, local(2026, 9, 1), local(2026, 12, 1)), [e]);
});

test("daily covers each day in range, ids are unique and map to the series", () => {
  const out = expand(series("daily", 2026, 11, 10), local(2026, 11, 12, 0), local(2026, 11, 14, 23));
  assert.deepEqual(out.map((o) => ymd(o.start)), ["2026-11-12", "2026-11-13", "2026-11-14"]);
  assert.equal(new Set(out.map((o) => o.id)).size, 3);
  assert.ok(out.every((o) => seriesId(o.id) === "abc" && o.series_id === "abc"));
});

test("occurrences keep the duration of the series", () => {
  const [o] = expand(series("weekly", 2026, 11, 1, 9, 3), local(2026, 11, 1, 0), local(2026, 11, 2, 0));
  assert.equal(new Date(o.end) - new Date(o.start), 3 * 3600 * 1000);
});

test("weekly steps by 7 days and ignores occurrences before the range", () => {
  assert.deepEqual(
    days(series("weekly", 2026, 10, 1), local(2026, 11, 1, 0), local(2026, 11, 30, 23)),
    ["2026-11-5", "2026-11-12", "2026-11-19", "2026-11-26"]
  );
});

test("nothing is generated before the series starts", () => {
  assert.deepEqual(days(series("daily", 2026, 11, 10), local(2026, 11, 1, 0), local(2026, 11, 9, 23)), []);
});

test("monthly on the 31st clamps to the last day of short months", () => {
  assert.deepEqual(
    days(series("monthly", 2026, 1, 31, 12), local(2026, 2, 1, 0), local(2026, 4, 30, 23)),
    ["2026-2-28", "2026-3-31", "2026-4-30"]
  );
});

test("yearly on Feb 29 falls on Feb 28 in non-leap years", () => {
  assert.deepEqual(
    days(series("yearly", 2024, 2, 29, 12), local(2027, 1, 1, 0), local(2028, 12, 31, 23)),
    ["2027-2-28", "2028-2-29"]
  );
});

test("an occurrence that spans into the range is included", () => {
  const e = series("weekly", 2026, 11, 1, 22, 5); // ends the next morning
  assert.deepEqual(days(e, local(2026, 11, 9, 0), local(2026, 11, 9, 23)), ["2026-11-8"]);
});

test("occurrences are completed once they end", (t) => {
  freeze();
  t.after(() => mock.timers.reset());
  const out = expand(series("daily", 2026, 11, 12), local(2026, 11, 12, 0), local(2026, 11, 14, 23));
  assert.deepEqual(out.map((o) => o.completed), [true, true, false]); // 13th 09-10h already over
});

test("with no range only the next occurrence is returned", (t) => {
  freeze();
  t.after(() => mock.timers.reset());
  const out = expand(series("weekly", 2026, 10, 1));
  assert.equal(out.length, 1);
  assert.equal(ymd(out[0].start), "2026-11-19");
  assert.equal(out[0].completed, false);
});

test("moving an occurrence shifts the whole series by the same delta", () => {
  const s = series("weekly", 2026, 11, 1);
  const occ = expand(s, local(2026, 11, 15, 0), local(2026, 11, 16, 23))[0]; // Nov 15
  const { body } = seriesBody({ ...occ, start: local(2026, 11, 16), end: local(2026, 11, 16, 10) });
  assert.equal(body.id, "abc");
  assert.equal(ymd(body.start), "2026-11-2"); // series start moved one day, not to the 16th
  assert.equal(new Date(body.end) - new Date(body.start), 3600 * 1000);
  assert.equal("completed" in body || "series_id" in body, false);
});

test("resizing an occurrence changes only the series end", () => {
  const s = series("daily", 2026, 11, 1);
  const occ = expand(s, local(2026, 11, 5, 0), local(2026, 11, 5, 23))[0];
  const { body } = seriesBody({ ...occ, end: local(2026, 11, 5, 12) });
  assert.equal(body.start, s.start);
  assert.equal(new Date(body.end) - new Date(body.start), 3 * 3600 * 1000);
});

test("repeat_until ends the series, that day included", () => {
  const s = { ...series("daily", 2026, 11, 10), repeat_until: local(2026, 11, 12, 23, 59) };
  assert.deepEqual(days(s, local(2026, 11, 1, 0), local(2026, 11, 30, 23)), [
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
  ]);
});

test("exceptions remove single occurrences, matched by local day", () => {
  // The exception keeps the old 09:00 start although the series moved to 11:00.
  const s = { ...series("daily", 2026, 11, 10, 11), exceptions: [local(2026, 11, 11, 9)] };
  assert.deepEqual(days(s, local(2026, 11, 10, 0), local(2026, 11, 12, 23)), [
    "2026-11-10",
    "2026-11-12",
  ]);
});

test("with no range a removed next occurrence is skipped", (t) => {
  freeze();
  t.after(() => mock.timers.reset());
  const s = { ...series("weekly", 2026, 10, 1), exceptions: [local(2026, 11, 19)] };
  assert.equal(ymd(expand(s)[0].start), "2026-11-26");
});

test("a finished series lists its last occurrence as completed", (t) => {
  freeze();
  t.after(() => mock.timers.reset());
  const s = { ...series("weekly", 2026, 9, 3), repeat_until: local(2026, 9, 30, 23, 59) };
  const out = expand(s);
  assert.equal(out.length, 1);
  assert.equal(ymd(out[0].start), "2026-9-24");
  assert.equal(out[0].completed, true);
});

test("a series with every occurrence removed lists nothing", (t) => {
  freeze();
  t.after(() => mock.timers.reset());
  const s = {
    ...series("daily", 2026, 11, 20),
    repeat_until: local(2026, 11, 21, 23, 59),
    exceptions: [local(2026, 11, 20), local(2026, 11, 21)],
  };
  assert.deepEqual(expand(s), []);
});

test("moving the series moves its exceptions too", () => {
  const s = { ...series("weekly", 2026, 11, 1), exceptions: [local(2026, 11, 8)] };
  const occ = expand(s, local(2026, 11, 15, 0), local(2026, 11, 16, 23))[0]; // Nov 15
  const { body } = seriesBody({ ...occ, start: local(2026, 11, 17), end: local(2026, 11, 17, 10) });
  assert.deepEqual(body.exceptions.map(ymd), ["2026-11-10"]); // +2 days, like the series
});

test("seriesBody is null for a plain event", () => {
  assert.equal(seriesBody({ id: "plain" }), null);
});
