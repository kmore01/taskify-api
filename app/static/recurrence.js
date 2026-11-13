import { parseDate } from "./dates.js";

// --- Recurrence -----------------------------------------------------------
// The API stores one document per series. Occurrences are built here, get the
// id "<seriesId>@<n>" so every DOM lookup stays unique, and are mapped back to
// the series by the functions below. Editing or deleting one affects the series.

const DAY = 24 * 60 * 60 * 1000;
// Shortest period in ms, used to skip ahead without walking every occurrence.
const MIN_PERIOD = { daily: DAY, weekly: 7 * DAY, monthly: 28 * DAY, yearly: 365 * DAY };
const MAX_OCCURRENCES = 1000;
export const seriesId = (id) => String(id).split("@")[0];
// id -> { n, start, end, base, baseEnd }: the occurrence as generated,
// plus the series' own start and end.
const occurrenceMeta = new Map();

function addRepeat(base, repeat, n) {
  const d = new Date(base);
  if (repeat === "daily") d.setDate(d.getDate() + n);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7 * n);
  else {
    // Months and years clamp to the last day (Jan 31 -> Feb 28).
    const months = repeat === "yearly" ? 12 * n : n;
    d.setDate(1);
    d.setMonth(base.getMonth() + months);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(base.getDate(), last));
  }
  return d;
}

export function occurrence(series, n) {
  const first = parseDate(series.start);
  const duration = parseDate(series.end) - first;
  const date = addRepeat(first, series.repeat, n);
  const deadline = new Date(date.getTime() + duration);
  const id = `${series.id}@${n}`;
  const done = deadline <= new Date();
  occurrenceMeta.set(id, {
    n,
    start: date.toISOString(),
    end: deadline.toISOString(),
    base: series.start,
    baseEnd: series.end,
  });
  return {
    ...series,
    id,
    series_id: series.id,
    start: date.toISOString(),
    end: deadline.toISOString(),
    completed: done,
  };
}

// First occurrence index whose end is at or after `from`.
function firstIndex(series, from) {
  const first = parseDate(series.start);
  const duration = parseDate(series.end) - first;
  return Math.max(0, Math.floor((from - first - duration) / MIN_PERIOD[series.repeat]) - 1);
}

// Occurrences overlapping [start, end]; with no range, just the next one.
export function expand(series, start, end) {
  if (!series.repeat || series.repeat === "none") return [series];
  if (!start && !end) {
    let n = firstIndex(series, Date.now());
    while (occurrence(series, n).completed) n++;
    return [occurrence(series, n)];
  }
  const out = [];
  const from = start ? parseDate(start) : parseDate(series.start);
  const to = end ? parseDate(end) : null;
  for (let n = firstIndex(series, from), i = 0; i < MAX_OCCURRENCES; n++, i++) {
    const occ = occurrence(series, n);
    if (to && parseDate(occ.start) > to) break;
    if (parseDate(occ.end) >= from) out.push(occ);
  }
  return out;
}


// Body for PUT when `evt` is an occurrence: moving or resizing one occurrence
// shifts the whole series by the same delta. Null for a plain event.
export function seriesBody(evt) {
  const meta = occurrenceMeta.get(evt.id);
  if (!meta) return null;
  const shift = (value, from, base) =>
    new Date(
      parseDate(base).getTime() + (parseDate(value).getTime() - parseDate(from).getTime())
    ).toISOString();
  const body = { ...evt, id: seriesId(evt.id) };
  delete body.series_id;
  delete body.completed;
  body.start = shift(evt.start, meta.start, meta.base);
  body.end = shift(evt.end, meta.end, meta.baseEnd);
  return { body, n: meta.n };
}
