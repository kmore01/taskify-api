import { login, logout, register, me, isAuthenticated } from "./auth.js";
import {
  activateCalendar,
  initCalendar,
  refreshCalendar,
  resetCalendar,
} from "./calendar.js";
import { fromLocalInput, parseDate, toLocalInput } from "./dates.js";
import {
  listTasksRange,
  createTask,
  updateTask,
  deleteTask,
  setTaskCompleted,
} from "./tasks.js";
import * as fx from "./fx.js";
import { makeCategoryPicker } from "./category-picker.js";

const state = {
  tasks: [],
  editingId: null,
  pendingDelete: null,
  sortBy: "deadline",
  search: "",
  category: "",
  view: "tasks",
  migratedDone: false,
  categoryPicker: null,
  loadId: 0,
};

const el = (id) => document.getElementById(id);
const field = (form, name) => form.elements.namedItem(name);

function formatDate(iso, allDay = false) {
  const date = parseDate(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(
    "es-ES",
    allDay ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }
  );
}

// Deadline proximity: "overdue", "soon" (<= 48 h) or "later".
function deadlineState(iso) {
  const diff = parseDate(iso).getTime() - Date.now();
  if (Number.isNaN(diff)) return "later";
  if (diff < 0) return "overdue";
  if (diff <= 48 * 60 * 60 * 1000) return "soon";
  return "later";
}

const DEADLINE_LABEL = { overdue: "Vencida", soon: "", later: "" };

// Pending tasks first; then by deadline or by title (accent-aware).
function sortTasks(tasks, sortBy = "deadline") {
  return [...tasks].sort((a, b) => {
    if (Boolean(a.completed) !== Boolean(b.completed)) return a.completed ? 1 : -1;
    if (sortBy === "title") {
      return a.title.localeCompare(b.title, "es", { sensitivity: "base", numeric: true });
    }
    return parseDate(a.deadline) - parseDate(b.deadline);
  });
}

// Completion lives in the backend. The old localStorage map is migrated once.

function doneStorageKey() {
  const user = el("current-user").textContent || "anon";
  return `taskify_done:${user.toLowerCase()}`;
}

function readDoneMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(doneStorageKey()));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Best-effort, one-time move of old client-side completions to MongoDB.
async function migrateDone() {
  if (state.migratedDone) return;
  state.migratedDone = true;
  const doneMap = readDoneMap();
  const ids = Object.keys(doneMap);
  if (ids.length === 0) return;

  const pending = state.tasks.filter((task) => doneMap[task.id] && !task.completed);
  await Promise.allSettled(
    pending.map(async (task) => {
      const day = doneMap[task.id];
      const completedAt = day
        ? new Date(`${day}T12:00:00`).toISOString()
        : new Date().toISOString();
      const updated = await updateTask(
        { ...task, completed: true, completed_at: completedAt },
        { silent: true }
      );
      Object.assign(task, updated);
    })
  );
  try {
    localStorage.removeItem(doneStorageKey());
  } catch {
    /* storage unavailable: nothing else to do */
  }
}

// Toggle a task's completion and react in place (no full re-render, so the
// stamp animation is not wiped out).
function setItemDone(item, isDone) {
  if (!item) return;
  item.classList.toggle("timeline__item--done", isDone);
  const check = item.querySelector(".timeline__check");
  if (check) {
    check.setAttribute("aria-pressed", String(isDone));
    check.setAttribute("aria-label", isDone ? "Marcar como no hecha" : "Marcar como hecha");
  }
}

async function toggleComplete(id, item) {
  const task = state.tasks.find((entry) => entry.id === id);
  if (!task) return;
  const next = !task.completed;
  const check = item && item.querySelector(".timeline__check");
  if (check) check.disabled = true;

  try {
    const updated = await setTaskCompleted(id, next);
    Object.assign(task, updated);
    setItemDone(item, updated.completed);
    if (updated.completed) {
      fx.complete(item); // stamp + confetti + sound: the one big moment
    } else {
      fx.sound.save(); // a soft tick, so un-completing never feels like an error
    }
    // Let the stamp play, then move the item to its section.
    setTimeout(renderTasks, updated.completed ? 900 : 0);
    refreshCalendar();
  } catch (error) {
    setStatus(el("app-status"), error.message, "error");
  } finally {
    if (check) check.disabled = false;
  }
}

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

function matchesFilters(task) {
  if (state.category && task.category !== state.category) return false;
  const query = state.search.trim().toLocaleLowerCase("es");
  if (!query) return true;
  return `${task.title} ${task.description || ""} ${task.category || ""}`
    .toLocaleLowerCase("es")
    .includes(query);
}

function taskCategories() {
  return [...new Set(state.tasks.map((t) => t.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
}

function mountCategoryPicker(current) {
  state.categoryPicker = makeCategoryPicker(current, taskCategories());
  el("task-category").replaceChildren(state.categoryPicker.node);
}

function renderCategoryFilter() {
  const select = el("filter-category");
  const categories = taskCategories();
  if (state.category && !categories.includes(state.category)) state.category = "";
  select.replaceChildren(new Option("Todas las categorías", ""));
  for (const name of categories) select.add(new Option(name, name));
  select.value = state.category;
  select.parentElement.hidden = categories.length === 0;
}

function renderTasks() {
  const list = el("task-list");
  const doneList = el("done-list");
  const doneSection = el("done-section");
  const empty = el("empty-state");
  renderCategoryFilter();

  const visible = sortTasks(state.tasks.filter(matchesFilters), state.sortBy);
  const pending = visible.filter((t) => !t.completed);
  const done = visible.filter((t) => t.completed);

  list.replaceChildren(...pending.map(renderItem));
  doneList.replaceChildren(...done.map(renderItem));
  el("done-count").textContent = String(done.length);
  list.hidden = pending.length === 0;
  doneSection.hidden = done.length === 0;

  const filtering = Boolean(state.search.trim() || state.category);
  empty.hidden = pending.length > 0;
  if (state.tasks.length === 0) {
    el("empty-title").textContent = "Aquí no hay nada que tachar.";
    el("empty-text").textContent = "Crea tu primera tarea (atajo: C).";
  } else if (filtering) {
    el("empty-title").textContent = "Nada coincide con el filtro.";
    el("empty-text").textContent = "Prueba con otra búsqueda o categoría.";
  } else {
    el("empty-title").textContent = "Todo tachado.";
    el("empty-text").textContent = "No te queda nada pendiente.";
  }
}

function renderItem(task) {
  const proximity = deadlineState(task.deadline);

  const item = document.createElement("li");
  item.className = `timeline__item timeline__item--${proximity}`;
  item.dataset.id = task.id;
  const isDone = Boolean(task.completed);
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

  const meta = document.createElement("p");
  meta.className = "timeline__meta";
  const label = isDone ? "" : DEADLINE_LABEL[proximity];
  if (label) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = label;
    meta.append(badge);
  }
  if (task.category) {
    const chip = document.createElement("span");
    chip.className = "badge badge--category";
    chip.dataset.color = task.color || "";
    chip.textContent = task.category;
    meta.append(chip);
  }
  meta.append(
    document.createTextNode(`Vence el ${formatDate(task.deadline, task.all_day)}`)
  );

  item.append(check, node, title);
  if (task.description) {
    const desc = document.createElement("p");
    desc.className = "timeline__desc";
    desc.textContent = task.description;
    item.append(desc);
  }
  item.append(meta, renderActions(task));
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
    field(form, "description").value = task.description || "";
    mountCategoryPicker(task.category || "");
    field(form, "date").value = toLocalInput(task.date);
    field(form, "deadline").value = toLocalInput(task.deadline);
    submit.textContent = "Actualizar";
  } else {
    form.reset();
    mountCategoryPicker(state.category); // preselect the active filter, if any
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
    category: state.categoryPicker.getValue() || null,
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
    refreshCalendar();
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

async function removeTask(id) {
  const status = el("app-status");
  const item = document.querySelector(`.timeline__item[data-id="${id}"]`);
  try {
    await deleteTask(id); // plays the lower delete sound
    state.tasks = state.tasks.filter((t) => t.id !== id);
    if (item) await fx.leave(item);
    setStatus(status, "Tarea eliminada.", "ok");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    state.pendingDelete = null;
    renderTasks();
    refreshCalendar();
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

async function loadTasks() {
  const status = el("app-status");
  const loadId = ++state.loadId;
  setStatus(status, "Cargando tareas…");
  try {
    const tasks = await listTasksRange(); // no range: walks every page
    if (loadId !== state.loadId) return;
    state.tasks = tasks;
    await migrateDone();
    if (loadId !== state.loadId) return;
    renderTasks();
    setStatus(status, "");
  } catch (error) {
    if (loadId !== state.loadId) return;
    state.tasks = [];
    renderTasks();
    setStatus(status, error.message, "error");
  }
}

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
  loadTasks();
}

function resetAppState() {
  state.loadId += 1;
  state.tasks = [];
  state.pendingDelete = null;
  state.editingId = null;
  state.migratedDone = false;
  closeForm();
  resetCalendar();
  selectView("tasks");
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

function onTabsKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const next = el("tab-login").getAttribute("aria-selected") === "true" ? "register" : "login";
  selectTab(next);
  el(next === "login" ? "tab-login" : "tab-register").focus();
}

function selectView(name) {
  state.view = name;
  const isTasks = name === "tasks";
  const tasksTab = el("tab-view-tasks");
  const calendarTab = el("tab-view-calendar");

  el("view-tasks").hidden = !isTasks;
  el("view-calendar").hidden = isTasks;
  tasksTab.setAttribute("aria-selected", String(isTasks));
  calendarTab.setAttribute("aria-selected", String(!isTasks));
  tasksTab.tabIndex = isTasks ? 0 : -1;
  calendarTab.tabIndex = isTasks ? -1 : 0;
  el("main").classList.toggle("content--wide", !isTasks);

  if (!isTasks) activateCalendar();
}

function onViewTabsKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const next = state.view === "tasks" ? "calendar" : "tasks";
  selectView(next);
  el(next === "tasks" ? "tab-view-tasks" : "tab-view-calendar").focus();
}

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
  resetAppState();
  showAuth();
}

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

// Task-view shortcuts; the calendar handles its own while it is visible.
function onGlobalKeydown(event) {
  if (el("view-app").hidden || state.view !== "tasks") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
  if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    openForm();
  } else if (event.key === "/") {
    event.preventDefault();
    el("task-search").focus();
  }
}

// Browser reminders when a timed task starts. Notified ids live in memory, so
// a reload never repeats past reminders (lastReminderCheck starts at load).
// shortcut: only fires while the tab is open; a real push service would be needed otherwise.
const NOTIFY_KEY = "taskify_notify";
const notified = new Set();
let lastReminderCheck = Date.now();

function notificationsOn() {
  let stored = null;
  try {
    stored = localStorage.getItem(NOTIFY_KEY);
  } catch {
    /* storage unavailable */
  }
  return "Notification" in window && Notification.permission === "granted" && stored === "1";
}

function syncNotifyButton() {
  const button = el("btn-notify");
  if (!("Notification" in window)) {
    button.hidden = true;
    return;
  }
  const on = notificationsOn();
  const label = on ? "Desactivar avisos" : "Activar avisos";
  button.setAttribute("aria-pressed", String(on));
  button.setAttribute("aria-label", label);
  button.title = label;
}

async function toggleNotifications() {
  const status = el("app-status");
  const turnOn = !notificationsOn();
  if (turnOn && Notification.permission !== "granted") {
    const result = await Notification.requestPermission();
    if (result !== "granted") {
      setStatus(status, "El navegador ha bloqueado los avisos.", "error");
      syncNotifyButton();
      return;
    }
  }
  try {
    localStorage.setItem(NOTIFY_KEY, turnOn ? "1" : "0");
  } catch {
    /* storage unavailable: preference lasts this page only */
  }
  syncNotifyButton();
  setStatus(
    status,
    turnOn ? "Te avisaré cuando empiece cada tarea." : "Avisos desactivados.",
    "ok"
  );
}

function checkReminders() {
  const now = Date.now();
  const since = lastReminderCheck;
  lastReminderCheck = now;
  if (!notificationsOn()) return;
  for (const task of state.tasks) {
    if (task.completed || task.all_day || notified.has(task.id)) continue;
    const start = parseDate(task.date).getTime();
    if (start > since && start <= now) {
      notified.add(task.id);
      new Notification(task.title, {
        body: `Empieza ahora · vence el ${formatDate(task.deadline)}`,
        tag: task.id,
      });
    }
  }
}

function init() {
  el("tab-login").addEventListener("click", () => selectTab("login"));
  el("tab-register").addEventListener("click", () => selectTab("register"));
  document.querySelector(".tabs").addEventListener("keydown", onTabsKeydown);
  el("form-login").addEventListener("submit", onLogin);
  el("form-register").addEventListener("submit", onRegister);
  el("btn-logout").addEventListener("click", onLogout);

  el("tab-view-tasks").addEventListener("click", () => selectView("tasks"));
  el("tab-view-calendar").addEventListener("click", () => selectView("calendar"));
  document.querySelector(".viewtabs").addEventListener("keydown", onViewTabsKeydown);
  initCalendar();

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
  el("task-form").addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeForm();
    el("btn-new").focus();
  });
  el("task-form").addEventListener("submit", submitTask);
  el("task-list").addEventListener("click", onListClick);
  el("done-list").addEventListener("click", onListClick);

  el("task-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderTasks();
  });
  el("filter-category").addEventListener("change", (event) => {
    state.category = event.target.value;
    renderTasks();
  });
  document.addEventListener("keydown", onGlobalKeydown);

  syncNotifyButton();
  el("btn-notify").addEventListener("click", toggleNotifications);
  setInterval(checkReminders, 30 * 1000);

  const sortSelect = el("sort-by");
  sortSelect.addEventListener("change", () => {
    state.sortBy = sortSelect.value;
    renderTasks();
  });

  window.addEventListener("taskify:unauthorized", () => {
    resetAppState();
    showAuth("Tu sesión expiró. Vuelve a entrar.");
  });
  document.addEventListener("taskify:tasks-changed", () => {
    loadTasks();
  });

  boot();
}

init();
