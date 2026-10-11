// tasks.js - Operaciones CRUD contra /tasks.

import { apiFetch } from "./api.js";

// Normaliza el listado: el backend puede devolver un array directo o
// un objeto paginado { items, total, page, page_size }.
function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export async function listTasks() {
  return normalizeList(await apiFetch("/tasks/"));
}

// Crea una tarea. El modelo exige id, title, description, date y deadline
// (id puede ser null en la creación).
export async function createTask(task) {
  return apiFetch("/tasks/", { method: "POST", body: task });
}

// Actualiza una tarea completa (reemplazo). El cuerpo debe incluir el id.
export async function updateTask(task) {
  return apiFetch("/tasks/", { method: "PUT", body: task });
}

// Elimina una tarea por id. El backend responde 204 sin cuerpo.
export async function deleteTask(id) {
  return apiFetch(`/tasks/${id}`, { method: "DELETE" });
}
