// dates.js - Shared local/UTC date helpers.
// The API returns naive UTC datetimes, so strings without a timezone get a Z.

const pad = (n) => String(n).padStart(2, "0");

export function parseDate(value) {
  if (typeof value === "string" && !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    return new Date(`${value}Z`);
  }
  return new Date(value);
}

export function toLocalInput(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function fromLocalInput(value) {
  return new Date(value).toISOString();
}

export function dayKey(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function startOfDay(value) {
  const date = value instanceof Date ? new Date(value) : parseDate(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(value) {
  const date = value instanceof Date ? new Date(value) : parseDate(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

export function addMonths(value, months) {
  const date = new Date(value);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return date;
}

export function startOfMonth(value) {
  const date = startOfDay(value);
  date.setDate(1);
  return date;
}

export function endOfMonth(value) {
  const date = startOfMonth(value);
  date.setMonth(date.getMonth() + 1, 0);
  return endOfDay(date);
}

// Monday-first week, matching Spanish calendars.
export function startOfWeek(value) {
  const date = startOfDay(value);
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

export function sameDay(a, b) {
  return dayKey(a) === dayKey(b);
}

export function isToday(value) {
  return sameDay(value, new Date());
}

export function diffDays(start, end) {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / 86400000);
}

export function formatTime(value) {
  return parseDate(value).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMonthYear(value) {
  const text = value.toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatLongDate(value) {
  const text = value.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatWeekRange(start, end) {
  const short = { day: "numeric", month: "short" };
  const left = start.toLocaleDateString("es-ES", short);
  const right = end.toLocaleDateString("es-ES", { ...short, year: "numeric" });
  return `${left} – ${right}`;
}
