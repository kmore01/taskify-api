import { login, logout, register, me, isAuthenticated } from "./auth.js";
import {
  activateCalendar,
  initCalendar,
  refreshCalendar,
  resetCalendar,
} from "./calendar.js";
import { fromLocalInput, parseDate, toLocalInput } from "./dates.js";
import {
  listEventsRange,
  isHttpUrl,
  exportIcs,
  importIcs,
  createEvent,
  updateEvent,
  deleteEvent,
} from "./events.js";
import * as fx from "./fx.js";
import { makeCategoryPicker } from "./category-picker.js";

const HIDDEN_KEY = "planifier_list_hidden";

// Like the calendar's menu: a per-browser preference, "" = no category.
function loadHiddenCategories() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_KEY));
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveHiddenCategories() {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...state.hiddenCategories]));
  } catch {
    /* storage unavailable: the choice lasts this page only */
  }
}

const state = {
  events: [],
  editingId: null,
  pendingDelete: null,
  sortBy: "end",
  search: "",
  hiddenCategories: loadHiddenCategories(),
  view: "events",
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

// Deadline proximity: "soon" (<= 48 h) or "later". Past events are already completed.
function deadlineState(iso) {
  const diff = parseDate(iso).getTime() - Date.now();
  if (Number.isNaN(diff)) return "later";
  if (diff <= 48 * 60 * 60 * 1000) return "soon";
  return "later";
}

const DEADLINE_LABEL = { soon: "", later: "" };

// Pending events first; then by deadline or by title (accent-aware).
function sortEvents(events, sortBy = "end") {
  return [...events].sort((a, b) => {
    if (Boolean(a.completed) !== Boolean(b.completed)) return a.completed ? 1 : -1;
    if (sortBy === "title") {
      return a.title.localeCompare(b.title, "es", { sensitivity: "base", numeric: true });
    }
    return parseDate(a.end) - parseDate(b.end);
  });
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

function matchesFilters(evt) {
  if (state.hiddenCategories.has(evt.category || "")) return false;
  const query = state.search.trim().toLocaleLowerCase("es");
  if (!query) return true;
  return `${evt.title} ${evt.description || ""} ${evt.category || ""}`
    .toLocaleLowerCase("es")
    .includes(query);
}

function eventCategories() {
  return [...new Set(state.events.map((t) => t.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
}

function mountCategoryPicker(current) {
  state.categoryPicker = makeCategoryPicker(current, eventCategories());
  el("event-category").replaceChildren(state.categoryPicker.node);
}

function renderCategoryFilter() {
  const menu = el("list-cats-menu");
  const categories = eventCategories();
  menu.hidden = categories.length === 0;
  const entries = [
    ...categories.map((name) => ({ key: name, label: name })),
    { key: "", label: "Sin categoría" },
  ];

  const title = document.createElement("p");
  title.className = "cal-cats__title";
  title.id = "list-cats-title";
  title.textContent = "Categorías";
  const list = document.createElement("ul");
  list.className = "cal-cats__list";
  list.setAttribute("aria-labelledby", "list-cats-title");
  for (const entry of entries) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !state.hiddenCategories.has(entry.key);
    input.addEventListener("change", () => {
      if (input.checked) state.hiddenCategories.delete(entry.key);
      else state.hiddenCategories.add(entry.key);
      saveHiddenCategories();
      renderEvents();
    });
    const label = document.createElement("label");
    label.className = "cal-cats__item";
    const text = document.createElement("span");
    text.textContent = entry.label;
    if (!entry.key) text.className = "cal-cats__none";
    label.append(input, text);
    const item = document.createElement("li");
    item.append(label);
    list.append(item);
  }
  el("list-categories").replaceChildren(title, list);

  const shown = entries.filter((entry) => !state.hiddenCategories.has(entry.key)).length;
  el("list-cats-count").textContent = shown < entries.length ? `${shown}/${entries.length}` : "";
}

function renderEvents() {
  const list = el("event-list");
  const doneList = el("done-list");
  const doneSection = el("done-section");
  const empty = el("empty-state");
  renderCategoryFilter();

  const visible = sortEvents(state.events.filter(matchesFilters), state.sortBy);
  const pending = visible.filter((t) => !t.completed);
  const done = visible.filter((t) => t.completed);

  list.replaceChildren(...pending.map(renderItem));
  doneList.replaceChildren(...done.map(renderItem));
  el("done-count").textContent = String(done.length);
  list.hidden = pending.length === 0;
  doneSection.hidden = done.length === 0;

  const filtering = Boolean(state.search.trim() || state.hiddenCategories.size);
  empty.hidden = pending.length > 0;
  if (state.events.length === 0) {
    el("empty-title").textContent = "Aquí no hay eventos.";
    el("empty-text").textContent = "Crea tu primer evento (atajo: C).";
  } else if (filtering) {
    el("empty-title").textContent = "Nada coincide con el filtro.";
    el("empty-text").textContent = "Prueba con otra búsqueda o categoría.";
  } else {
    el("empty-title").textContent = "Todo al día.";
    el("empty-text").textContent = "No tienes eventos pendientes.";
  }
}

function renderItem(evt) {
  const proximity = deadlineState(evt.end);

  const item = document.createElement("li");
  item.className = `timeline__item timeline__item--${proximity}`;
  item.dataset.id = evt.id;
  const isDone = Boolean(evt.completed);
  if (isDone) item.classList.add("timeline__item--done");
  if (state.pendingDelete === evt.id) item.classList.add("timeline__item--confirming");

  const check = document.createElement("span");
  check.className = "timeline__check";
  check.setAttribute("aria-hidden", "true");

  const node = document.createElement("span");
  node.className = "timeline__node";
  node.setAttribute("aria-hidden", "true");

  const title = document.createElement("h2");
  title.className = "timeline__title";
  title.textContent = evt.title;

  const meta = document.createElement("p");
  meta.className = "timeline__meta";
  const label = isDone ? "" : DEADLINE_LABEL[proximity];
  if (label) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = label;
    meta.append(badge);
  }
  if (evt.category) {
    const chip = document.createElement("span");
    chip.className = "badge badge--category";
    chip.dataset.color = evt.color || "";
    chip.textContent = evt.category;
    meta.append(chip);
  }
  if (evt.location) meta.append(document.createTextNode(`${evt.location} · `));
  if (isHttpUrl(evt.link)) {
    const a = document.createElement("a");
    a.href = evt.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Enlace";
    meta.append(a, document.createTextNode(" · "));
  }
  meta.append(
    document.createTextNode(`Termina el ${formatDate(evt.end, evt.all_day)}`)
  );

  item.append(check, node, title);
  if (evt.description) {
    const desc = document.createElement("p");
    desc.className = "timeline__desc";
    desc.textContent = evt.description;
    item.append(desc);
  }
  item.append(meta, renderActions(evt));
  return item;
}

function renderActions(evt) {
  const wrap = document.createElement("div");
  wrap.className = "timeline__actions";

  if (state.pendingDelete === evt.id) {
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
    makeIconButton("Editar evento", ICON_EDIT, "edit", evt.id),
    makeIconButton("Eliminar evento", ICON_DELETE, "delete", evt.id)
  );
  return wrap;
}

function openForm(evt = null) {
  const form = el("event-form");
  const submit = el("event-submit");

  form.hidden = false;
  el("btn-new").setAttribute("aria-expanded", "true");
  state.editingId = evt ? evt.id : null;
  setStatus(el("app-status"), "");

  if (evt) {
    field(form, "id").value = evt.id;
    field(form, "title").value = evt.title;
    field(form, "description").value = evt.description || "";
    mountCategoryPicker(evt.category || "");
    field(form, "start").value = toLocalInput(evt.start);
    field(form, "end").value = toLocalInput(evt.end);
    field(form, "location").value = evt.location || "";
    field(form, "link").value = evt.link || "";
    field(form, "repeat").value = evt.repeat || "none";
    submit.textContent = "Actualizar";
  } else {
    form.reset();
    // Preselect the category when the filter leaves exactly one visible.
    const shown = eventCategories().filter((name) => !state.hiddenCategories.has(name));
    mountCategoryPicker(
      shown.length === 1 && state.hiddenCategories.has("") ? shown[0] : ""
    );
    const now = new Date();
    field(form, "start").value = toLocalInput(now.toISOString());
    field(form, "end").value = toLocalInput(
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    );
    submit.textContent = "Guardar";
  }

  field(form, "title").focus();
}

function closeForm() {
  const form = el("event-form");
  form.hidden = true;
  form.reset();
  state.editingId = null;
  el("btn-new").setAttribute("aria-expanded", "false");
  el("event-submit").textContent = "Guardar";
}

function startEdit(id) {
  const evt = state.events.find((t) => t.id === id);
  if (evt) openForm(evt);
}

async function submitEvent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = el("event-submit");
  const status = el("app-status");

  if (!form.reportValidity()) return;

  const wasEditing = Boolean(state.editingId);
  const payload = {
    id: state.editingId || null,
    title: field(form, "title").value.trim(),
    description: field(form, "description").value.trim(),
    category: state.categoryPicker.getValue() || null,
    start: fromLocalInput(field(form, "start").value),
    end: fromLocalInput(field(form, "end").value),
    location: field(form, "location").value.trim() || null,
    link: field(form, "link").value.trim() || null,
    repeat: field(form, "repeat").value,
  };

  submit.disabled = true;
  setStatus(status, wasEditing ? "Actualizando…" : "Guardando…");

  try {
    let createdId = null;
    if (wasEditing) {
      const updated = await updateEvent(payload);
      state.events = state.events.map((t) => (t.id === updated.id ? updated : t));
    } else {
      const created = await createEvent(payload); // plays the soft create pop
      state.events.push(created);
      createdId = created.id;
    }
    closeForm();
    renderEvents();
    refreshCalendar();
    if (createdId) {
      fx.enter(document.querySelector(`.timeline__item[data-id="${createdId}"]`));
    }
    setStatus(status, wasEditing ? "Evento actualizado." : "Guardado. Ya está en la lista.", "ok");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    submit.disabled = false;
  }
}

async function removeEvent(id) {
  const status = el("app-status");
  const item = document.querySelector(`.timeline__item[data-id="${id}"]`);
  try {
    await deleteEvent(id); // plays the lower delete sound
    state.events = state.events.filter((t) => t.id !== id);
    if (item) await fx.leave(item);
    setStatus(status, "Evento eliminado.", "ok");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    state.pendingDelete = null;
    renderEvents();
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
    case "delete":
      state.pendingDelete = id;
      renderEvents();
      break;
    case "cancel-delete":
      state.pendingDelete = null;
      renderEvents();
      break;
    case "confirm-delete":
      removeEvent(id);
      break;
  }
}

async function onImportFile(event) {
  const input = event.currentTarget;
  const [file] = input.files;
  input.value = ""; // allow picking the same file again
  if (!file) return;
  const status = el("app-status");
  setStatus(status, "Importando…");
  try {
    const r = await importIcs(file);
    const notes = [];
    if (r.skipped) notes.push(`${r.skipped} ya existían`);
    if (r.simplified) notes.push(`${r.simplified} con repetición no soportada se importaron sin repetir`);
    if (r.invalid) notes.push(`${r.invalid} no válidos`);
    setStatus(
      status,
      `Importados ${r.imported} eventos${notes.length ? ` (${notes.join("; ")})` : ""}.`,
      "ok"
    );
    await loadEvents();
    refreshCalendar();
  } catch (error) {
    setStatus(status, error.message, "error");
  }
}

async function onExport() {
  try {
    await exportIcs();
  } catch (error) {
    setStatus(el("app-status"), error.message, "error");
  }
}

async function loadEvents() {
  const status = el("app-status");
  const loadId = ++state.loadId;
  setStatus(status, "Cargando eventos…");
  try {
    const events = await listEventsRange(); // no range: walks every page
    if (loadId !== state.loadId) return;
    state.events = events;
    renderEvents();
    setStatus(status, "");
  } catch (error) {
    if (loadId !== state.loadId) return;
    state.events = [];
    renderEvents();
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
  loadEvents();
}

function resetAppState() {
  state.loadId += 1;
  state.events = [];
  state.pendingDelete = null;
  state.editingId = null;
  state.migratedDone = false;
  closeForm();
  resetCalendar();
  selectView("events");
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
  const isEvents = name === "events";
  const eventsTab = el("tab-view-events");
  const calendarTab = el("tab-view-calendar");

  el("view-events").hidden = !isEvents;
  el("view-calendar").hidden = isEvents;
  eventsTab.setAttribute("aria-selected", String(isEvents));
  calendarTab.setAttribute("aria-selected", String(!isEvents));
  eventsTab.tabIndex = isEvents ? 0 : -1;
  calendarTab.tabIndex = isEvents ? -1 : 0;
  el("main").classList.toggle("content--wide", !isEvents);

  if (!isEvents) activateCalendar();
}

function onViewTabsKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const next = state.view === "events" ? "calendar" : "events";
  selectView(next);
  el(next === "events" ? "tab-view-events" : "tab-view-calendar").focus();
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

// Event-view shortcuts; the calendar handles its own while it is visible.
function onGlobalKeydown(event) {
  if (el("view-app").hidden || state.view !== "events") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
  if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    openForm();
  } else if (event.key === "/") {
    event.preventDefault();
    el("event-search").focus();
  }
}

// Browser reminders when a timed evt starts. Notified ids live in memory, so
// a reload never repeats past reminders (lastReminderCheck starts at load).
// shortcut: only fires while the tab is open; a real push service would be needed otherwise.
const NOTIFY_KEY = "planifier_notify";
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
    turnOn ? "Te avisaré cuando empiece cada evento." : "Avisos desactivados.",
    "ok"
  );
}

function checkReminders() {
  const now = Date.now();
  const since = lastReminderCheck;
  lastReminderCheck = now;
  if (!notificationsOn()) return;
  for (const evt of state.events) {
    if (evt.completed || evt.all_day || notified.has(evt.id)) continue;
    const start = parseDate(evt.start).getTime();
    if (start > since && start <= now) {
      notified.add(evt.id);
      new Notification(evt.title, {
        body: `Empieza ahora · termina el ${formatDate(evt.end)}`,
        tag: evt.id,
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

  el("tab-view-events").addEventListener("click", () => selectView("events"));
  el("tab-view-calendar").addEventListener("click", () => selectView("calendar"));
  document.querySelector(".viewtabs").addEventListener("keydown", onViewTabsKeydown);
  initCalendar();

  syncMuteButton();
  el("btn-mute").addEventListener("click", () => {
    fx.toggleMute();
    syncMuteButton();
  });

  el("btn-new").addEventListener("click", () => {
    if (el("event-form").hidden) openForm();
    else closeForm();
  });
  el("event-cancel").addEventListener("click", closeForm);
  el("event-form").addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeForm();
    el("btn-new").focus();
  });
  el("event-form").addEventListener("submit", submitEvent);
  el("event-list").addEventListener("click", onListClick);
  el("done-list").addEventListener("click", onListClick);

  el("event-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderEvents();
  });
  document.addEventListener("pointerdown", (event) => {
    const menu = el("list-cats-menu");
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  el("list-cats-menu").addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary").focus();
  });
  document.addEventListener("keydown", onGlobalKeydown);

  syncNotifyButton();
  el("btn-notify").addEventListener("click", toggleNotifications);
  el("btn-export").addEventListener("click", onExport);
  el("btn-import").addEventListener("click", () => el("import-file").click());
  el("import-file").addEventListener("change", onImportFile);
  setInterval(checkReminders, 30 * 1000);

  const sortSelect = el("sort-by");
  sortSelect.addEventListener("change", () => {
    state.sortBy = sortSelect.value;
    renderEvents();
  });

  window.addEventListener("planifier:unauthorized", () => {
    resetAppState();
    showAuth("Tu sesión expiró. Vuelve a entrar.");
  });
  document.addEventListener("planifier:events-changed", () => {
    loadEvents();
  });

  boot();
}

init();
