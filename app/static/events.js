import { ApiError, apiFetch, getToken } from "./api.js";
import { sound } from "./fx.js";
import { expand, seriesBody, occurrence, seriesId } from "./recurrence.js";


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

// Delete by id. Backend replies 204 with no body.
export async function deleteEvent(id) {
  const result = await apiFetch(`/events/${seriesId(id)}`, { method: "DELETE" });
  sound.remove();
  return result;
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
