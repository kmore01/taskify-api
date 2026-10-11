// tasks.js - CRUD against /tasks.

import { apiFetch } from "./api.js";
import { sound } from "./fx.js";

// Accept a plain array or the paginated { items } shape.
function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export async function listTasks() {
  return normalizeList(await apiFetch("/tasks/"));
}

// Create: the model requires id (null ok), title, description, date and deadline.
export async function createTask(task) {
  const created = await apiFetch("/tasks/", { method: "POST", body: task });
  sound.create();
  return created;
}

// Update replaces the whole task; the body must include id.
export async function updateTask(task) {
  const updated = await apiFetch("/tasks/", { method: "PUT", body: task });
  sound.save();
  return updated;
}

// Delete by id. Backend replies 204 with no body.
export async function deleteTask(id) {
  const result = await apiFetch(`/tasks/${id}`, { method: "DELETE" });
  sound.remove();
  return result;
}
