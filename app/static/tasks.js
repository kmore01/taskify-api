// tasks.js - CRUD against /tasks.

import { apiFetch } from "./api.js";
import { sound } from "./fx.js";

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

export async function listTasks(params = {}) {
  return normalizeList(await apiFetch(`/tasks/${buildQuery(params)}`));
}

// Walk every page for a visible calendar range.
export async function listTasksRange(start, end) {
  const limit = 500;
  const items = [];
  let skip = 0;
  let total = null;

  while (total === null || skip < total) {
    const data = await apiFetch(
      `/tasks/${buildQuery({ start, end, skip, limit })}`
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

  return items;
}

// Create: the model requires id (null ok), title, description, date and deadline.
export async function createTask(task) {
  const created = await apiFetch("/tasks/", { method: "POST", body: task });
  sound.create();
  return created;
}

// Update sends the fields it has; the backend preserves the rest.
export async function updateTask(task, { silent = false } = {}) {
  const updated = await apiFetch("/tasks/", { method: "PUT", body: task });
  if (!silent) sound.save();
  return updated;
}

// Completion is backend state; the calendar and the list share it.
export async function setTaskCompleted(id, completed) {
  return apiFetch(`/tasks/${id}/completed`, {
    method: "PATCH",
    body: { completed },
  });
}

// Delete by id. Backend replies 204 with no body.
export async function deleteTask(id) {
  const result = await apiFetch(`/tasks/${id}`, { method: "DELETE" });
  sound.remove();
  return result;
}
