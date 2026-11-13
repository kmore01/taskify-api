import { ApiError, apiFetch, getToken } from "./api.js";
import { sound } from "./fx.js";
import { expand, originalStart, seriesBody, occurrence, seriesId } from "./recurrence.js";


export const isHttpUrl = (value) => /^https?:\/\//i.test(value || "");

// Accept a plain array or the paginated { items } shape.
function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function listEvents(params = {}) {
  return normalizeList(await apiFetch(`/events/${buildQuery(params)}`));
}

// Walk every page for a visible calendar range.
export async function listEventsRange(start, end) {
  const limit = 500;
  const items = [];
  let skip = 0;
  let total = null;

  while (total === null || skip < total) {
    const data = await apiFetch(
      `/events/${buildQuery({ start, end, skip, limit })}`
    );
    if (Array.isArray(data)) {
      items.push(...data);
      break;
    }
    const page = Array.isArray(data && data.items) ? data.items : [];
    items.push(...page);
    total = Number.isFinite(data && data.total) ? data.total : items.length;
    if (page.length === 0) break;
    skip += page.length;
  }

  return items.flatMap((item) => expand(item, start, end));
}

// Create: the model requires title, start and end.
export async function createEvent(evt) {
  const created = await apiFetch("/events/", { method: "POST", body: evt });
  sound.create();
  return created;
}

// Update sends the fields it has; the backend preserves the rest.
export async function updateEvent(evt, { silent = false } = {}) {
  const series = seriesBody(evt);
  const updated = await apiFetch("/events/", {
    method: "PUT",
    body: series ? series.body : evt,
  });
  if (!silent) sound.save();
  return series ? occurrence(updated, series.n) : updated;
}

// The stored document behind `evt`: the series when `evt` is an occurrence.
const stored = (evt) => seriesBody(evt)?.body ?? evt;

// Delete an event or a whole series. Resolves to an undo function that
// creates it again (same data, new id).
export async function deleteEvent(evt) {
  const doc = stored(evt);
  await apiFetch(`/events/${doc.id}`, { method: "DELETE" });
  sound.remove();
  return () => apiFetch("/events/", { method: "POST", body: { ...doc, id: null } });
}

// "Only this one": remove a single occurrence from its series. Resolves to an
// undo function that puts it back.
export async function skipOccurrence(evt, { silent = false } = {}) {
  const doc = stored(evt);
  const before = doc.exceptions || [];
  const put = (exceptions) =>
    apiFetch("/events/", { method: "PUT", body: { ...doc, exceptions } });
  await put([...before, originalStart(evt.id)]);
  if (!silent) sound.remove();
  return () => put(before);
}

// "Only this one" for edits: the occurrence leaves the series and becomes a
// plain event carrying `changes`. Created first, so a failure in between
// leaves a visible duplicate rather than a lost event.
export async function detachOccurrence(evt, changes) {
  const created = await apiFetch("/events/", {
    method: "POST",
    body: { ...changes, id: null, repeat: "none", repeat_until: null, exceptions: [] },
  });
  await skipOccurrence(evt, { silent: true });
  sound.save();
  return created;
}

// Distinct categories across all of the user's events (not just a date range).
export async function listCategories() {
  return apiFetch("/events/categories");
}

// --- .ics export / import ---------------------------------------------------
// The timezone localizes all-day events and floating times on the server.
const zoneQuery = () =>
  `tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;

export async function exportIcs() {
  let response;
  try {
    response = await fetch(`/events/export.ics?${zoneQuery()}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
  } catch {
    throw new ApiError("No se pudo conectar con el servidor.", 0);
  }
  if (!response.ok) throw new ApiError("No se pudo exportar el calendario.", response.status);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "planifier.ics";
  link.click();
  URL.revokeObjectURL(url);
}

// Resolves to { imported, skipped, simplified, invalid }.
export async function importIcs(file) {
  return apiFetch(`/events/import?${zoneQuery()}`, {
    method: "POST",
    headers: { "Content-Type": "text/calendar" },
    body: await file.text(),
  });
}
