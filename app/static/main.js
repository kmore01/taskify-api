// main.js - App bootstrap and UI logic.

import { login, logout, register, me, isAuthenticated } from "./auth.js";
import { listTasks, createTask, updateTask, deleteTask } from "./tasks.js";
import * as fx from "./fx.js";

// In-memory state for the main view.
const state = {
  tasks: [],
  editingId: null,
  pendingDelete: null,
  dragStartId: null,
  sortBy: 'deadline',
  sortDir: 'asc',
  done: {}, // taskId -> "YYYY-MM-DD" local completion date (client-side only)
};

const el = (id) => document.getElementById(id);
const field = (form, name) => form.elements.namedItem(name);

// Dates

// The backend returns UTC datetimes without a timezone suffix; treat them as UTC.
function parseDate(value) {
  if (typeof value === "string" && !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    return new Date(`${value}Z`);
  }
  return new Date(value);
}

// ISO from the backend -> value for <input type="datetime-local">.
function toLocalInput(iso) {
  const date = parseDate(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// Value from <input type="datetime-local"> -> UTC ISO.
function fromLocalInput(value) {
  return new Date(value).toISOString();
}

function formatDate(iso) {
  const date = parseDate(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

// Deadline proximity: "overdue", "soon" (<= 48 h) or "later".
function deadlineState(iso) {
  const diff = parseDate(iso).getTime() - Date.now();
  if (Number.isNaN(diff)) return "later";
  if (diff < 0) return "overdue";
  if (diff <= 48 * 60 * 60 * 1000) return "soon";
  return "later";
}

const DEADLINE_LABEL = { overdue: "Vencida", soon: "Próxima", later: "" };

// Ordenar tareas por criterio y dirección.
function sortTasks(tasks, sortBy = 'deadline', sortDir = 'asc') {
  const sorted = [...tasks];
  const compare = (a, b) => {
    const valA = sortBy === 'deadline' ? parseDate(a.deadline) : a.title;
    const valB = sortBy === 'deadline' ? parseDate(b.deadline) : b.title;
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  };
  return sorted.sort(compare);
}

// Completion, daily progress and streak (localStorage only; the backend has no
// "completed" field, so this state lives in the browser per user).

function dayKey(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function doneStorageKey() {
  const user = el("current-user").textContent || "anon";
  return `taskify_done:${user.toLowerCase()}`;
}

function loadDone() {
  try {
    const parsed = JSON.parse(localStorage.getItem(doneStorageKey()));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveDone() {
  try {
    localStorage.setItem(doneStorageKey(), JSON.stringify(state.done));
  } catch {
    /* storage unavailable: completion still works for this session */
  }
}

function deadlineIsToday(task) {
  if (!task.deadline) return false;
  const deadline = parseDate(task.deadline);
  const now = new Date();
  return (
    deadline.getFullYear() === now.getFullYear() &&
    deadline.getMonth() === now.getMonth() &&
    deadline.getDate() === now.getDate()
  );
}

// Consecutive days (ending today or yesterday) with at least one completion.
function computeStreak() {
  const days = new Set(Object.values(state.done));
  const cursor = new Date();
  if (!days.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderToday() {
  const dueToday = state.tasks.filter(deadlineIsToday);
  const doneToday = dueToday.filter((task) => state.done[task.id]);
  const total = dueToday.length;
  const done = doneToday.length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  el("day-count").textContent = `${done}/${total}`;
  el("day-progress-fill").style.width = `${percent}%`;

  const bar = el("day-progress");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(done));

  const note = el("today-note");
  if (total === 0) {
    note.textContent = "Sin vencimientos para hoy. Respira.";
  } else if (done === total) {
    note.textContent = "Todo lo de hoy, tachado. Crack.";
  } else {
    const left = total - done;
    note.textContent = left === 1 ? "Te queda 1 para hoy." : `Te quedan ${left} para hoy.`;
  }

  const streak = computeStreak();
  const streakNode = el("streak");
  streakNode.querySelector("b").textContent = String(streak);
  streakNode.setAttribute("aria-label", streak === 1 ? "Racha: 1 día" : `Racha: ${streak} días`);
  streakNode.setAttribute(
    "title",
    streak === 1 ? "1 día seguido completando tareas" : `${streak} días seguidos completando tareas`
  );
}

// Toggle a task's local completion and react in place (no full re-render, so
// the stamp animation is not wiped out).
function setItemDone(item, isDone) {
  if (!item) return;
  item.classList.toggle("timeline__item--done", isDone);
  const check = item.querySelector(".timeline__check");
  if (check) {
    check.setAttribute("aria-pressed", String(isDone));
    check.setAttribute("aria-label", isDone ? "Marcar como no hecha" : "Marcar como hecha");
  }
}

function toggleComplete(id, item) {
  const wasDone = Boolean(state.done[id]);
  if (wasDone) {
    delete state.done[id];
    fx.sound.save(); // a soft tick, so un-completing never feels like an error
  } else {
    state.done[id] = dayKey(new Date());
    fx.complete(item); // stamp + confetti + sound: the one big moment
  }
  saveDone();
  setItemDone(item, !wasDone);
  renderToday();
}

// UI helpers

function setStatus(node, message = "", kind = "info") {
  node.textContent = message;
  if (message) {
    node.dataset.kind = kind;
  } else {
    delete node.dataset.kind;
  }
}

function makeButton(text, className, action, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.dataset.action = action;
  if (id) button.dataset.id = id;
  return button;
}

const ICON_EDIT = `
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
       aria-hidden="true" focusable="false">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
  </svg>`;

const ICON_DELETE = `
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
       aria-hidden="true" focusable="false">
    <path d="M3 6h18"/>
    <path d="M8 6V4h8v2"/>
    <path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v5"/>
    <path d="M14 11v5"/>
  </svg>`;

function makeIconButton(label, icon, action, id) {
  const button = makeButton("", "btn btn--ghost btn--sm btn--icon", action, id);
  button.innerHTML = icon;
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

// Rendering

function renderTasks() {
  const list = el("task-list");
  const empty = el("empty-state");
  list.innerHTML = "";

  empty.hidden = state.tasks.length > 0;
  list.hidden = state.tasks.length === 0;

  const sorted = sortTasks(state.tasks, state.sortBy, state.sortDir);
  for (const task of sorted) {
    list.appendChild(renderItem(task));
  }
}

function renderItem(task) {
  const proximity = deadlineState(task.deadline);

  const item = document.createElement("li");
  item.className = `timeline__item timeline__item--${proximity}`;
  item.dataset.id = task.id;
  item.draggable = true;
  const isDone = Boolean(state.done[task.id]);
  if (isDone) item.classList.add("timeline__item--done");
  if (state.pendingDelete === task.id) item.classList.add("timeline__item--confirming");

  const check = document.createElement("button");
  check.type = "button";
  check.className = "timeline__check";
  check.dataset.action = "complete";
  check.dataset.id = task.id;
  check.setAttribute("aria-pressed", String(isDone));
  check.setAttribute("aria-label", isDone ? "Marcar como no hecha" : "Marcar como hecha");

  const node = document.createElement("span");
  node.className = "timeline__node";
  node.setAttribute("aria-hidden", "true");

  const title = document.createElement("h2");
  title.className = "timeline__title";
  title.textContent = task.title;

  const desc = document.createElement("p");
  desc.className = "timeline__desc";
  desc.textContent = task.description;

  const meta = document.createElement("p");
  meta.className = "timeline__meta";
  const label = DEADLINE_LABEL[proximity];
  if (label) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = label;
    meta.append(badge);
  }
  meta.append(document.createTextNode(`Vence el ${formatDate(task.deadline)}`));

  item.append(check, node, title, desc, meta, renderActions(task));
  return item;
}

function renderActions(task) {
  const wrap = document.createElement("div");
  wrap.className = "timeline__actions";

  if (state.pendingDelete === task.id) {
    const ask = document.createElement("span");
    ask.className = "confirm__ask";
    ask.textContent = "¿Eliminar?";
    wrap.append(
      ask,
      makeButton("Sí, eliminar", "btn btn--danger btn--sm", "confirm-delete"),
      makeButton("Cancelar", "btn btn--ghost btn--sm", "cancel-delete")
    );
    return wrap;
  }

  wrap.append(
    makeIconButton("Editar tarea", ICON_EDIT, "edit", task.id),
    makeIconButton("Eliminar tarea", ICON_DELETE, "delete", task.id)
  );
  return wrap;
}

// Task form

function openForm(task = null) {
  const form = el("task-form");
  const submit = el("task-submit");

  form.hidden = false;
  el("btn-new").setAttribute("aria-expanded", "true");
  state.editingId = task ? task.id : null;
  setStatus(el("app-status"), "");

  if (task) {
    field(form, "id").value = task.id;
    field(form, "title").value = task.title;
    field(form, "description").value = task.description;
    field(form, "date").value = toLocalInput(task.date);
    field(form, "deadline").value = toLocalInput(task.deadline);
    submit.textContent = "Actualizar";
  } else {
    form.reset();
    const now = new Date();
    field(form, "date").value = toLocalInput(now.toISOString());
    field(form, "deadline").value = toLocalInput(
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    );
    submit.textContent = "Guardar";
  }

  field(form, "title").focus();
}

function closeForm() {
  const form = el("task-form");
  form.hidden = true;
  form.reset();
  state.editingId = null;
  el("btn-new").setAttribute("aria-expanded", "false");
  el("task-submit").textContent = "Guardar";
}

function startEdit(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (task) openForm(task);
}

async function submitTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = el("task-submit");
  const status = el("app-status");

  if (!form.reportValidity()) return;

  const wasEditing = Boolean(state.editingId);
  const payload = {
    id: state.editingId || null,
    title: field(form, "title").value.trim(),
    description: field(form, "description").value.trim(),
    date: fromLocalInput(field(form, "date").value),
    deadline: fromLocalInput(field(form, "deadline").value),
  };

  submit.disabled = true;
  setStatus(status, wasEditing ? "Actualizando…" : "Guardando…");

  try {
    let createdId = null;
    if (wasEditing) {
      const updated = await updateTask(payload);
      state.tasks = state.tasks.map((t) => (t.id === updated.id ? updated : t));
    } else {
      const created = await createTask(payload); // plays the soft create pop
      state.tasks.push(created);
      createdId = created.id;
    }
    closeForm();
    renderTasks();
    renderToday();
    if (createdId) {
      fx.enter(document.querySelector(`.timeline__item[data-id="${createdId}"]`));
    }
    setStatus(status, wasEditing ? "Tarea actualizada." : "Guardada. Ya está en la lista.", "ok");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    submit.disabled = false;
  }
}

// List actions

async function removeTask(id) {
  const status = el("app-status");
  const item = document.querySelector(`.timeline__item[data-id="${id}"]`);
  try {
    await deleteTask(id); // plays the lower delete sound
    state.tasks = state.tasks.filter((t) => t.id !== id);
    if (state.done[id]) {
      delete state.done[id];
      saveDone();
    }
    if (item) await fx.leave(item);
    setStatus(status, "Tarea eliminada.", "ok");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    state.pendingDelete = null;
    renderTasks();
    renderToday();
  }
}

function onListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const item = button.closest(".timeline__item");
  const id = button.dataset.id || (item && item.dataset.id);

  switch (button.dataset.action) {
    case "edit":
      startEdit(id);
      break;
    case "complete":
      toggleComplete(id, item);
      break;
    case "delete":
      state.pendingDelete = id;
      renderTasks();
      break;
    case "cancel-delete":
      state.pendingDelete = null;
      renderTasks();
      break;
    case "confirm-delete":
      removeTask(id);
      break;
  }
}

// Drag-and-drop reordering

function handleDragStart(event) {
  const item = event.target.closest(".timeline__item");
  if (!item) return;
  state.dragStartId = item.dataset.id;
  item.classList.add("dragging");
}

function handleDragOver(event) {
  event.preventDefault();
  const afterElement = getDragAfterElement(
    el("task-list"),
    event.clientY
  );
  const draggable = document.querySelector(
    `.timeline__item[data-id="${state.dragStartId}"]`
  );
  if (!draggable) return;
  if (afterElement == null) {
    el("task-list").appendChild(draggable);
  } else {
    el("task-list").insertBefore(draggable, afterElement);
  }
}

function handleDrop() {
  el("task-list")
    .querySelectorAll(".timeline__item")
    .forEach((node) => node.classList.remove("dragging"));
  state.dragStartId = null;
}

function handleDragEnd() {
  el("task-list")
    .querySelectorAll(".timeline__item")
    .forEach((node) => node.classList.remove("dragging"));
  state.dragStartId = null;
}

function getDragAfterElement(container, y) {
  const draggableElements = [
    ...container.querySelectorAll(".timeline__item:not(.dragging)"),
  ];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Data loading

async function loadTasks() {
  const status = el("app-status");
  setStatus(status, "Cargando tareas…");
  try {
    state.tasks = await listTasks();
    renderTasks();
    renderToday();
    setStatus(status, "");
  } catch (error) {
    state.tasks = [];
    renderTasks();
    renderToday();
    setStatus(status, error.message, "error");
  }
}

// Views

function showAuth(message = "") {
  el("view-app").hidden = true;
  el("view-auth").hidden = false;
  setStatus(el("auth-status"), message, "error");
  el("form-login").elements.namedItem("username").focus();
}

function showApp(user) {
  el("view-auth").hidden = true;
  el("view-app").hidden = false;
  el("current-user").textContent = (user && user.username) || "";
  state.done = loadDone(); // per-user completion state from localStorage
  loadTasks();
}

function selectTab(name) {
  const isLogin = name === "login";
  const tabLogin = el("tab-login");
  const tabRegister = el("tab-register");

  tabLogin.setAttribute("aria-selected", String(isLogin));
  tabRegister.setAttribute("aria-selected", String(!isLogin));
  tabLogin.tabIndex = isLogin ? 0 : -1;
  tabRegister.tabIndex = isLogin ? -1 : 0;

  el("form-login").hidden = !isLogin;
  el("form-register").hidden = isLogin;
  setStatus(el("auth-status"), "");
}

// Arrow-key navigation between ARIA tabs.
function onTabsKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const next = el("tab-login").getAttribute("aria-selected") === "true" ? "register" : "login";
  selectTab(next);
  el(next === "login" ? "tab-login" : "tab-register").focus();
}

// Auth

async function onLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = el("auth-status");
  const button = form.querySelector("button[type=submit]");
  if (!form.reportValidity()) return;

  button.disabled = true;
  setStatus(status, "Entrando…");
  try {
    await login(
      field(form, "username").value.trim(),
      field(form, "password").value
    );
    const user = await me();
    form.reset();
    showApp(user);
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function onRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = el("auth-status");
  const button = form.querySelector("button[type=submit]");
  if (!form.reportValidity()) return;

  const username = field(form, "username").value.trim();
  const email = field(form, "email").value.trim();
  const password = field(form, "password").value;

  button.disabled = true;
  setStatus(status, "Creando cuenta…");
  try {
    await register({ username, email, password });
    await login(username, password); // Auto sign-in after registration.
    const user = await me();
    form.reset();
    showApp(user);
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function onLogout() {
  logout();
  state.tasks = [];
  state.pendingDelete = null;
  state.done = {};
  closeForm();
  showAuth();
}

// Boot

async function boot() {
  if (!isAuthenticated()) {
    showAuth();
    return;
  }
  try {
    const user = await me();
    showApp(user);
  } catch {
    // A 401 already cleared the session and showed the login view.
    if (isAuthenticated()) showAuth("No se pudo verificar la sesión.");
  }
}

function syncMuteButton() {
  const button = el("btn-mute");
  const muted = fx.isMuted();
  button.setAttribute("aria-pressed", String(muted));
  button.setAttribute("aria-label", muted ? "Activar sonido" : "Silenciar");
}

function init() {
  el("tab-login").addEventListener("click", () => selectTab("login"));
  el("tab-register").addEventListener("click", () => selectTab("register"));
  document.querySelector(".tabs").addEventListener("keydown", onTabsKeydown);
  el("form-login").addEventListener("submit", onLogin);
  el("form-register").addEventListener("submit", onRegister);
  el("btn-logout").addEventListener("click", onLogout);

  syncMuteButton();
  el("btn-mute").addEventListener("click", () => {
    fx.toggleMute();
    syncMuteButton();
  });

  el("btn-new").addEventListener("click", () => {
    if (el("task-form").hidden) openForm();
    else closeForm();
  });
  el("task-cancel").addEventListener("click", closeForm);
  el("task-form").addEventListener("submit", submitTask);
  el("task-list").addEventListener("click", onListClick);

  // Drag-and-drop reordering
  el("task-list").addEventListener("dragstart", handleDragStart);
  el("task-list").addEventListener("dragover", handleDragOver);
  el("task-list").addEventListener("drop", handleDrop);
  el("task-list").addEventListener("dragend", handleDragEnd);

  const sortSelect = el("sort-by");
  sortSelect.addEventListener("change", () => {
    // Si cambia el criterio, reiniciar a asc; si es el mismo, alternar
    if (state.sortBy === sortSelect.value) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortBy = sortSelect.value;
      state.sortDir = 'asc';
    }
    renderTasks();
  });

  window.addEventListener("taskify:unauthorized", () => {
    showAuth("Tu sesión expiró. Vuelve a entrar.");
  });

  boot();
}

init();
