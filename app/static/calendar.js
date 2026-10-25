// calendar.js - Calendar views and interactions.

import {
  addDays,
  addMonths,
  dateFromKey,
  dayKey,
  diffDays,
  endOfDay,
  endOfMonth,
  formatLongDate,
  formatMonthYear,
  formatTime,
  formatWeekRange,
  isToday,
  parseDate,
  sameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "./dates.js";
import { sound } from "./fx.js";
import {
  createTask,
  deleteTask,
  listTasksRange,
  setTaskCompleted,
  updateTask,
} from "./tasks.js";

const DAY_NAMES = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const WEEKDAY_NAMES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const LANE_HEIGHT = 22;
const DAY_HEAD = 30;
const MONTH_ROWS = 6;
const HOUR_HEIGHT = 48;
const MINUTES_PER_DAY = 24 * 60;
const SNAP_MINUTES = 15;
const MAX_END_MINUTES = MINUTES_PER_DAY - SNAP_MINUTES;
const MIN_EVENT_HEIGHT = 18;
const ALL_DAY_LANES = 2;

const COLORS = [
  { key: "tomato", label: "Tomate" },
  { key: "flamingo", label: "Flamenco" },
  { key: "tangerine", label: "Naranja" },
  { key: "banana", label: "Plátano" },
  { key: "sage", label: "Salvia" },
  { key: "basil", label: "Albahaca" },
  { key: "peacock", label: "Pavo real" },
  { key: "blueberry", label: "Arándano" },
  { key: "lavender", label: "Lavanda" },
  { key: "grape", label: "Uva" },
  { key: "graphite", label: "Grafito" },
];

const state = {
  active: false,
  initialized: false,
  dirty: true,
  view: "month",
  cursor: startOfDay(new Date()),
  tasks: [],
  requestId: 0,
  maxLanes: 3,
  timeScroll: null,
  suppressClick: false,
};

const el = (id) => document.getElementById(id);

function setStatus(message = "", kind = "info") {
  const node = el("cal-status");
  if (!node) return;
  node.textContent = message;
  if (message) {
    node.dataset.kind = kind;
  } else {
    delete node.dataset.kind;
  }
}

function maxLanesForWidth() {
  return window.innerWidth < 720 ? 2 : 3;
}

// Ranges

function monthGridStart() {
  return startOfWeek(startOfMonth(state.cursor));
}

function visibleRange() {
  if (state.view === "week") {
    const start = startOfWeek(state.cursor);
    return { start, end: endOfDay(addDays(start, 6)) };
  }
  if (state.view === "day") {
    const start = startOfDay(state.cursor);
    return { start, end: endOfDay(start) };
  }
  if (state.view === "agenda") {
    return { start: startOfMonth(state.cursor), end: endOfMonth(state.cursor) };
  }
  const start = monthGridStart();
  return { start, end: endOfDay(addDays(start, MONTH_ROWS * 7 - 1)) };
}

function renderTitle() {
  const title = el("cal-title");
  if (!title) return;
  if (state.view === "month" || state.view === "agenda") {
    title.textContent = formatMonthYear(state.cursor);
  } else if (state.view === "week") {
    const start = startOfWeek(state.cursor);
    title.textContent = formatWeekRange(start, addDays(start, 6));
  } else {
    title.textContent = formatLongDate(state.cursor);
  }
}

// Data

async function loadCalendar() {
  if (!state.initialized) return;
  const { start, end } = visibleRange();
  const requestId = ++state.requestId;
  state.dirty = false;
  setStatus("Cargando calendario…");

  try {
    const tasks = await listTasksRange(start.toISOString(), end.toISOString());
    if (requestId !== state.requestId) return;
    state.tasks = tasks;
    setStatus("");
  } catch (error) {
    if (requestId !== state.requestId) return;
    state.tasks = [];
    state.dirty = true;
    setStatus(error.message, "error");
  }
  renderCalendar();
}

// Month view

function renderCalendar() {
  if (!state.initialized) return;
  renderTitle();
  el("cal-view").value = state.view;
  if (state.view === "month") {
    renderMonth();
  } else if (state.view === "week" || state.view === "day") {
    renderTimeView();
  } else {
    renderAgenda();
  }
  renderMini();
}

function renderMonth() {
  const main = el("cal-main");
  main.innerHTML = "";

  const month = startOfMonth(state.cursor);
  const gridStart = monthGridStart();
  const wrapper = document.createElement("div");
  wrapper.className = "cal-month";

  const weekdays = document.createElement("div");
  weekdays.className = "cal-month__weekdays";
  for (const name of DAY_NAMES) {
    const cell = document.createElement("span");
    cell.className = "cal-month__weekday";
    cell.textContent = name;
    weekdays.appendChild(cell);
  }
  wrapper.appendChild(weekdays);

  for (let row = 0; row < MONTH_ROWS; row += 1) {
    wrapper.appendChild(renderWeek(addDays(gridStart, row * 7), month));
  }

  main.appendChild(wrapper);
}

function renderWeek(weekStart, month) {
  const week = document.createElement("div");
  week.className = "cal-week";
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const cells = [];

  for (const day of days) {
    const cell = document.createElement("div");
    cell.className = "cal-day";
    cell.dataset.date = dayKey(day);
    if (day.getMonth() !== month.getMonth()) cell.classList.add("cal-day--out");
    if (isToday(day)) cell.classList.add("cal-day--today");

    const number = document.createElement("span");
    number.className = "cal-day__num";
    number.textContent = String(day.getDate());
    cell.appendChild(number);
    cell.addEventListener("click", () => openTaskForm(null, { date: day }));

    cells.push(cell);
    week.appendChild(cell);
  }

  const overlay = document.createElement("div");
  overlay.className = "cal-week__events";
  const hidden = new Map();

  for (const segment of layoutSegments(state.tasks, weekStart, 7)) {
    if (segment.lane >= state.maxLanes) {
      for (let col = segment.startCol; col <= segment.endCol; col += 1) {
        const key = dayKey(days[col]);
        hidden.set(key, (hidden.get(key) || 0) + 1);
      }
      continue;
    }
    overlay.appendChild(renderMonthEvent(segment));
  }
  week.appendChild(overlay);

  for (const [key, count] of hidden) {
    const col = diffDays(weekStart, dateFromKey(key));
    const cell = cells[col];
    if (!cell) continue;

    const more = document.createElement("button");
    more.type = "button";
    more.className = "cal-day__more";
    more.dataset.date = key;
    more.dataset.popoverTrigger = "true";
    more.textContent = `+${count} más`;
    more.setAttribute("aria-label", `${count} tareas más el ${key}`);
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      openDayList(key);
    });
    cell.appendChild(more);
  }

  return week;
}

function layoutSegments(tasks, rangeStart, dayCount) {
  const rangeEnd = addDays(rangeStart, dayCount);
  const lastCol = dayCount - 1;
  const segments = [];

  for (const task of tasks) {
    const taskStart = startOfDay(parseDate(task.date));
    let taskEnd = startOfDay(parseDate(task.deadline || task.date));
    if (taskEnd < taskStart) taskEnd = taskStart;
    if (taskEnd < rangeStart || taskStart >= rangeEnd) continue;

    const startCol = Math.max(0, diffDays(rangeStart, taskStart));
    const endCol = Math.min(lastCol, diffDays(rangeStart, taskEnd));
    if (startCol > lastCol || endCol < 0) continue;

    segments.push({
      task,
      startCol,
      endCol,
      lane: 0,
      multiDay: !sameDay(taskStart, taskEnd) || Boolean(task.all_day),
      endsHere: diffDays(rangeStart, taskEnd) <= lastCol,
    });
  }

  segments.sort((a, b) => {
    if (a.multiDay !== b.multiDay) return a.multiDay ? -1 : 1;
    if (Boolean(a.task.completed) !== Boolean(b.task.completed)) {
      return a.task.completed ? 1 : -1;
    }
    const byDate = String(a.task.date).localeCompare(String(b.task.date));
    if (byDate !== 0) return byDate;
    return String(a.task.title).localeCompare(String(b.task.title), "es");
  });

  const lanes = [];
  for (const segment of segments) {
    let lane = 0;
    while (
      lanes[lane] &&
      lanes[lane].some(
        (other) =>
          segment.startCol <= other.endCol && segment.endCol >= other.startCol
      )
    ) {
      lane += 1;
    }
    segment.lane = lane;
    (lanes[lane] ||= []).push(segment);
  }

  return segments;
}

function renderMonthEvent(segment) {
  const task = segment.task;
  const event = document.createElement("div");
  event.className = "cal-event";
  if (task.completed) event.classList.add("cal-event--done");
  if (task.color) event.dataset.color = task.color;
  event.dataset.id = task.id;
  event.dataset.action = "open-task";
  event.dataset.popoverTrigger = "true";
  event.style.left = `calc(${(segment.startCol / 7) * 100}% + 3px)`;
  event.style.width = `calc(${((segment.endCol - segment.startCol + 1) / 7) * 100}% - 6px)`;
  event.style.top = `${DAY_HEAD + segment.lane * LANE_HEIGHT}px`;

  const time =
    !task.all_day && !segment.multiDay ? `${formatTime(task.date)} ` : "";
  event.textContent = `${time}${task.title}`;
  event.title = event.textContent;
  event.tabIndex = 0;
  event.setAttribute("role", "button");

  if (segment.endsHere) {
    const handle = document.createElement("span");
    handle.className = "cal-event__resize";
    handle.title = "Cambiar fecha de fin";
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", (pointerEvent) =>
      startResizePointer(pointerEvent, task)
    );
    event.appendChild(handle);
  }

  event.addEventListener("pointerdown", (pointerEvent) =>
    startMovePointer(pointerEvent, task)
  );
  event.addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    openTaskDetails(task);
  });
  event.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
      keyEvent.preventDefault();
      openTaskDetails(task);
    }
  });

  return event;
}

// Week and day views

function timeViewDays() {
  if (state.view === "week") {
    const start = startOfWeek(state.cursor);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }
  return [startOfDay(state.cursor)];
}

function renderTimeView() {
  const main = el("cal-main");
  main.innerHTML = "";
  const days = timeViewDays();
  const wrapper = document.createElement("div");
  wrapper.className = `cal-time cal-time--${state.view}`;
  wrapper.style.setProperty("--cal-days", String(days.length));
  wrapper.append(
    renderTimeHeader(days),
    renderAllDayRow(days),
    renderTimeGrid(days)
  );
  main.appendChild(wrapper);

  const scroll = wrapper.querySelector(".cal-time__scroll");
  if (!scroll) return;
  if (state.timeScroll != null) {
    scroll.scrollTop = state.timeScroll;
  } else {
    const now = new Date();
    scroll.scrollTop = days.some((day) => isToday(day))
      ? Math.max(0, (now.getHours() - 1) * HOUR_HEIGHT)
      : 7 * HOUR_HEIGHT;
  }
  scroll.addEventListener(
    "scroll",
    () => {
      state.timeScroll = scroll.scrollTop;
    },
    { passive: true }
  );
}

function renderTimeHeader(days) {
  const head = document.createElement("div");
  head.className = "cal-time__head";
  const gutter = document.createElement("div");
  gutter.className = "cal-time__gutter";
  gutter.setAttribute("aria-hidden", "true");
  head.appendChild(gutter);

  for (const day of days) {
    const cell = document.createElement("div");
    cell.className = "cal-time__dayhead";
    cell.dataset.date = dayKey(day);
    if (isToday(day)) cell.classList.add("cal-time__dayhead--today");

    const weekday = document.createElement("span");
    weekday.className = "cal-time__weekday";
    weekday.textContent =
      state.view === "day"
        ? day.toLocaleDateString("es-ES", { weekday: "long" })
        : WEEKDAY_NAMES[day.getDay()];

    const number = document.createElement("span");
    number.className = "cal-time__daynum";
    number.textContent = String(day.getDate());

    cell.append(weekday, number);
    head.appendChild(cell);
  }

  return head;
}

function renderAllDayRow(days) {
  const rangeStart = days[0];
  const dayCount = days.length;
  const tasks = state.tasks.filter((task) => task.all_day);
  const segments = layoutSegments(tasks, rangeStart, dayCount);
  const maxLane = segments.reduce(
    (max, segment) => Math.max(max, segment.lane),
    -1
  );
  const visibleLanes = maxLane < 0 ? 0 : Math.min(ALL_DAY_LANES, maxLane + 1);

  const row = document.createElement("div");
  row.className = "cal-time__allday";
  const gutter = document.createElement("div");
  gutter.className = "cal-time__gutter cal-time__allday-label";
  gutter.textContent = "Todo el día";

  const grid = document.createElement("div");
  grid.className = "cal-time__allday-grid";
  const cells = new Map();
  for (const day of days) {
    const key = dayKey(day);
    const cell = document.createElement("div");
    cell.className = "cal-allday-col";
    cell.dataset.date = key;
    cell.addEventListener("click", () => {
      openTaskForm(null, { date: day, allDay: true });
    });
    grid.appendChild(cell);
    cells.set(key, cell);
  }

  const overlay = document.createElement("div");
  overlay.className = "cal-time__allday-events";
  const hidden = new Map();
  for (const segment of segments) {
    if (segment.lane >= ALL_DAY_LANES) {
      for (let col = segment.startCol; col <= segment.endCol; col += 1) {
        const key = dayKey(days[col]);
        hidden.set(key, (hidden.get(key) || 0) + 1);
      }
      continue;
    }
    overlay.appendChild(renderAllDayEvent(segment, dayCount));
  }
  grid.appendChild(overlay);

  for (const [key, count] of hidden) {
    const cell = cells.get(key);
    if (!cell) continue;
    const more = makeButton(
      `+${count} más`,
      "cal-allday__more",
      (event) => {
        event.stopPropagation();
        openDayList(key);
      }
    );
    more.dataset.popoverTrigger = "true";
    more.setAttribute("aria-label", `${count} tareas más el ${key}`);
    cell.appendChild(more);
  }

  grid.style.height = `${Math.max(
    30,
    visibleLanes * 20 + (hidden.size ? 24 : 10)
  )}px`;

  row.append(gutter, grid);
  return row;
}

function renderAllDayEvent(segment, dayCount) {
  const task = segment.task;
  const event = document.createElement("div");
  event.className = "cal-event cal-allday-event";
  if (task.completed) event.classList.add("cal-event--done");
  if (task.color) event.dataset.color = task.color;
  event.dataset.id = task.id;
  event.dataset.popoverTrigger = "true";
  event.style.left = `calc(${(segment.startCol / dayCount) * 100}% + 2px)`;
  event.style.width = `calc(${((segment.endCol - segment.startCol + 1) / dayCount) * 100}% - 4px)`;
  event.style.top = `${4 + segment.lane * 20}px`;
  event.style.height = "18px";
  event.textContent = task.title;
  event.title = task.title;
  event.tabIndex = 0;
  event.setAttribute("role", "button");

  if (segment.endsHere) {
    const handle = document.createElement("span");
    handle.className = "cal-event__resize";
    handle.title = "Cambiar fecha de fin";
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", (pointerEvent) =>
      startAllDayResizePointer(pointerEvent, task)
    );
    event.appendChild(handle);
  }

  event.addEventListener("pointerdown", (pointerEvent) =>
    startAllDayMovePointer(pointerEvent, task)
  );
  event.addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    openTaskDetails(task);
  });
  event.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
      keyEvent.preventDefault();
      openTaskDetails(task);
    }
  });

  return event;
}

function renderTimeGrid(days) {
  const scroll = document.createElement("div");
  scroll.className = "cal-time__scroll";
  const body = document.createElement("div");
  body.className = "cal-time__body";

  const gutter = document.createElement("div");
  gutter.className = "cal-time__gutter cal-time__hours";
  gutter.setAttribute("aria-hidden", "true");
  for (let hour = 0; hour < 24; hour += 1) {
    const label = document.createElement("div");
    label.className = "cal-time__hour";
    label.textContent = `${pad2(hour)}:00`;
    gutter.appendChild(label);
  }
  body.appendChild(gutter);

  const grid = document.createElement("div");
  grid.className = "cal-time__grid";
  const tasks = state.tasks.filter((task) => !task.all_day);

  for (const day of days) {
    const key = dayKey(day);
    const column = document.createElement("div");
    column.className = "cal-time__col";
    column.dataset.date = key;
    if (isToday(day)) column.classList.add("cal-time__col--today");

    const events = timedEventsForDay(tasks, day);
    layoutTimedEvents(events);
    for (const entry of events) {
      column.appendChild(renderTimedEvent(entry, day));
    }
    if (isToday(day)) column.appendChild(renderNowLine());
    column.addEventListener("pointerdown", (event) =>
      startCreatePointer(event, day, column)
    );
    grid.appendChild(column);
  }

  body.appendChild(grid);
  scroll.appendChild(body);
  return scroll;
}

function renderNowLine() {
  const line = document.createElement("div");
  line.className = "cal-time__now";
  line.setAttribute("aria-hidden", "true");
  line.style.top = `${nowTop()}px`;
  return line;
}

function nowTop() {
  const now = new Date();
  return ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;
}

function updateNowLines() {
  const top = nowTop();
  document.querySelectorAll(".cal-time__now").forEach((node) => {
    node.style.top = `${top}px`;
  });
}

let lastNowDay = dayKey(new Date());

function tickNow() {
  if (!state.active) return;
  const key = dayKey(new Date());
  if (key !== lastNowDay) {
    lastNowDay = key;
    if (state.view === "week" || state.view === "day") renderCalendar();
    return;
  }
  if (state.view === "week" || state.view === "day") updateNowLines();
}

function timedEventsForDay(tasks, day) {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const result = [];

  for (const task of tasks) {
    const { start, end } = taskWindow(task);
    if (end <= dayStart || start >= dayEnd) continue;
    const clipStart = new Date(Math.max(start.getTime(), dayStart.getTime()));
    const clipEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
    if (clipEnd <= clipStart) continue;

    const startMinutes = Math.max(0, minutesOfDay(clipStart));
    let endMinutes =
      clipEnd.getTime() >= dayEnd.getTime()
        ? MINUTES_PER_DAY
        : minutesOfDay(clipEnd);
    if (endMinutes <= startMinutes) {
      endMinutes = Math.min(MINUTES_PER_DAY, startMinutes + SNAP_MINUTES);
    }
    result.push({ task, start: clipStart, end: clipEnd, startMinutes, endMinutes });
  }

  return result;
}

function layoutTimedEvents(events) {
  events.sort((a, b) => a.start - b.start || b.end - a.end);
  const lanes = [];

  for (const event of events) {
    let lane = lanes.findIndex((endTime) => endTime <= event.start.getTime());
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(event.end.getTime());
    } else {
      lanes[lane] = event.end.getTime();
    }
    event.lane = lane;
  }

  const columns = Math.max(1, lanes.length);
  for (const event of events) event.columns = columns;
  return events;
}

function renderTimedEvent(entry, day) {
  const { task, startMinutes, endMinutes, lane, columns } = entry;
  const height = Math.max(
    MIN_EVENT_HEIGHT,
    ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT - 2
  );
  const block = document.createElement("div");
  block.className = "cal-time__event";
  if (height < 34) block.classList.add("cal-time__event--short");
  if (task.completed) block.classList.add("cal-time__event--done");
  if (task.color) block.dataset.color = task.color;
  block.dataset.id = task.id;
  block.dataset.popoverTrigger = "true";
  block.style.top = `${Math.min(
    (startMinutes / 60) * HOUR_HEIGHT,
    (MINUTES_PER_DAY / 60) * HOUR_HEIGHT - height
  )}px`;
  block.style.height = `${height}px`;
  block.style.left = `calc(${(lane / columns) * 100}% + 2px)`;
  block.style.width = `calc(${(1 / columns) * 100}% - 4px)`;
  block.tabIndex = 0;
  block.setAttribute("role", "button");

  const title = document.createElement("span");
  title.className = "cal-time__event-title";
  title.textContent = task.title;
  block.appendChild(title);

  const timeText = timedSegmentLabel(task, day);
  if (timeText) {
    const time = document.createElement("span");
    time.className = "cal-time__event-time";
    time.textContent = timeText;
    block.appendChild(time);
  }
  block.title = `${task.title}${timeText ? ` · ${timeText}` : ""}`;
  block.setAttribute("aria-label", block.title);

  if (sameDay(parseDate(task.deadline), day)) {
    const handle = document.createElement("span");
    handle.className = "cal-time__event-resize";
    handle.title = "Cambiar hora de fin";
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", (pointerEvent) =>
      startTimedResizePointer(pointerEvent, task)
    );
    block.appendChild(handle);
  }

  block.addEventListener("pointerdown", (pointerEvent) =>
    startTimedMovePointer(pointerEvent, task)
  );
  block.addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    openTaskDetails(task);
  });
  block.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
      keyEvent.preventDefault();
      openTaskDetails(task);
    }
  });

  return block;
}

function timedSegmentLabel(task, day) {
  const { start, end } = taskWindow(task);
  const startsHere = sameDay(start, day);
  const endsHere = sameDay(end, day);
  if (startsHere && endsHere) {
    return `${formatTime(start)} – ${formatTime(end)}`;
  }
  if (startsHere) return `${formatTime(start)} …`;
  if (endsHere) return `… ${formatTime(end)}`;
  return "";
}

// Time helpers and interactions

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function minutesFromClientY(clientY, column) {
  const rect = column.getBoundingClientRect();
  return ((clientY - rect.top) / HOUR_HEIGHT) * 60;
}

function snapMinutes(value, mode = "nearest") {
  const rounded =
    mode === "down"
      ? Math.floor(value / SNAP_MINUTES) * SNAP_MINUTES
      : Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, Math.min(MAX_END_MINUTES, rounded));
}

function minutesToTime(minutes) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function dayUnderPointerTime(x, y) {
  const nodes = document.elementsFromPoint(x, y);
  for (const node of nodes) {
    if (
      node.classList &&
      (node.classList.contains("cal-time__col") ||
        node.classList.contains("cal-allday-col"))
    ) {
      return node.dataset.date;
    }
  }
  return null;
}

function highlightTimeDay(key) {
  document
    .querySelectorAll(".cal-time__col--drop, .cal-allday-col--drop")
    .forEach((node) => {
      node.classList.remove("cal-time__col--drop", "cal-allday-col--drop");
    });
  if (!key) return;
  document
    .querySelector(`.cal-time__col[data-date="${key}"]`)
    ?.classList.add("cal-time__col--drop");
  document
    .querySelector(`.cal-allday-col[data-date="${key}"]`)
    ?.classList.add("cal-allday-col--drop");
}

function startTimedMovePointer(event, task) {
  if (event.button !== undefined && event.button !== 0) return;
  if (event.target.closest(".cal-time__event-resize")) return;
  event.stopPropagation();

  const startX = event.clientX;
  const startY = event.clientY;
  const originKey =
    dayUnderPointerTime(startX, startY) || dayKey(parseDate(task.date));
  const originalDate = parseDate(task.date);
  const originalDeadline = parseDate(task.deadline);
  const node = event.currentTarget;
  const rect = node.getBoundingClientRect();
  let dragging = false;
  let ghost = null;

  function onMove(moveEvent) {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 5) return;
      dragging = true;
      suppressNextClick();
      node.classList.add("cal-event--dragging");
      ghost = node.cloneNode(true);
      ghost.classList.remove("cal-event--dragging");
      ghost.classList.add("cal-event-ghost");
      ghost.setAttribute("aria-hidden", "true");
      ghost.tabIndex = -1;
      ghost.style.position = "fixed";
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
    }
    ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    highlightTimeDay(dayUnderPointerTime(moveEvent.clientX, moveEvent.clientY));
  }

  function onUp(upEvent) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    highlightTimeDay(null);
    if (ghost) ghost.remove();
    node.classList.remove("cal-event--dragging");
    if (upEvent.type === "pointercancel" || !dragging) return;

    const targetKey = dayUnderPointerTime(upEvent.clientX, upEvent.clientY);
    if (!targetKey) return;
    const deltaDays = diffDays(
      dateFromKey(originKey),
      dateFromKey(targetKey)
    );
    const deltaMinutes =
      Math.round(
        ((upEvent.clientY - startY) / HOUR_HEIGHT) * 60 / SNAP_MINUTES
      ) * SNAP_MINUTES;
    if (deltaDays === 0 && deltaMinutes === 0) return;

    const date = new Date(
      addDays(originalDate, deltaDays).getTime() + deltaMinutes * 60000
    );
    const deadline = new Date(
      addDays(originalDeadline, deltaDays).getTime() + deltaMinutes * 60000
    );
    if (deadline <= date) return;
    void updateTaskDates(task, date.toISOString(), deadline.toISOString());
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function startTimedResizePointer(event, task) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const startY = event.clientY;
  const node = event.currentTarget.closest(".cal-time__event");
  let resizing = false;

  function onMove(moveEvent) {
    if (!resizing) {
      if (Math.abs(moveEvent.clientY - startY) < 4) return;
      resizing = true;
      suppressNextClick();
      if (node) node.classList.add("cal-event--dragging");
    }
    highlightTimeDay(
      dayUnderPointerTime(moveEvent.clientX, moveEvent.clientY)
    );
  }

  function onUp(upEvent) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    highlightTimeDay(null);
    if (node) node.classList.remove("cal-event--dragging");
    if (upEvent.type === "pointercancel" || !resizing) return;

    const targetKey = dayUnderPointerTime(
      upEvent.clientX,
      upEvent.clientY
    );
    if (!targetKey) return;
    const targetColumn = document.querySelector(
      `.cal-time__col[data-date="${targetKey}"]`
    );
    if (!targetColumn) return;

    const targetDay = dateFromKey(targetKey);
    const start = parseDate(task.date);
    if (targetDay < startOfDay(start)) return;
    const minutes = snapMinutes(
      minutesFromClientY(upEvent.clientY, targetColumn)
    );
    const deadline = new Date(
      targetDay.getFullYear(),
      targetDay.getMonth(),
      targetDay.getDate(),
      0,
      minutes
    );
    if (deadline <= start) {
      setStatus("La hora de fin debe ser posterior al inicio.", "error");
      return;
    }
    void updateTaskDates(task, task.date, deadline.toISOString());
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function startAllDayMovePointer(event, task) {
  if (event.button !== undefined && event.button !== 0) return;
  event.stopPropagation();

  const startX = event.clientX;
  const startY = event.clientY;
  const originKey =
    dayUnderPointerTime(startX, startY) || dayKey(parseDate(task.date));
  const node = event.currentTarget;
  const rect = node.getBoundingClientRect();
  let dragging = false;
  let ghost = null;

  function onMove(moveEvent) {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 5) return;
      dragging = true;
      suppressNextClick();
      node.classList.add("cal-event--dragging");
      ghost = node.cloneNode(true);
      ghost.classList.remove("cal-event--dragging");
      ghost.classList.add("cal-event-ghost");
      ghost.setAttribute("aria-hidden", "true");
      ghost.tabIndex = -1;
      ghost.style.position = "fixed";
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
    }
    ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    highlightTimeDay(dayUnderPointerTime(moveEvent.clientX, moveEvent.clientY));
  }

  function onUp(upEvent) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    highlightTimeDay(null);
    if (ghost) ghost.remove();
    node.classList.remove("cal-event--dragging");
    if (upEvent.type === "pointercancel" || !dragging) return;

    const targetKey = dayUnderPointerTime(upEvent.clientX, upEvent.clientY);
    if (!targetKey) return;
    const delta = diffDays(dateFromKey(originKey), dateFromKey(targetKey));
    if (delta === 0) return;
    void shiftTaskDays(task, delta);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function startAllDayResizePointer(event, task) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const node = event.currentTarget.closest(".cal-event");
  let resizing = false;

  function onMove(moveEvent) {
    if (!resizing) {
      if (Math.abs(moveEvent.clientX - startX) < 5) return;
      resizing = true;
      suppressNextClick();
      if (node) node.classList.add("cal-event--dragging");
    }
    highlightTimeDay(
      dayUnderPointerTime(moveEvent.clientX, moveEvent.clientY)
    );
  }

  function onUp(upEvent) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    highlightTimeDay(null);
    if (node) node.classList.remove("cal-event--dragging");
    if (upEvent.type === "pointercancel" || !resizing) return;

    const targetKey = dayUnderPointerTime(
      upEvent.clientX,
      upEvent.clientY
    );
    if (targetKey) void resizeTaskToDay(task, targetKey);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function startCreatePointer(event, day, column) {
  if (event.button !== undefined && event.button !== 0) return;
  const startY = event.clientY;
  const anchor = snapMinutes(minutesFromClientY(startY, column), "down");
  let dragging = false;
  let ghost = null;

  function onMove(moveEvent) {
    if (!dragging) {
      if (Math.abs(moveEvent.clientY - startY) < 5) return;
      dragging = true;
      ghost = document.createElement("div");
      ghost.className = "cal-time__create-ghost";
      column.appendChild(ghost);
    }
    const current = snapMinutes(
      minutesFromClientY(moveEvent.clientY, column)
    );
    const from = Math.min(anchor, current);
    const to = Math.max(anchor, current);
    ghost.style.top = `${(from / 60) * HOUR_HEIGHT}px`;
    ghost.style.height = `${Math.max(8, ((to - from) / 60) * HOUR_HEIGHT)}px`;
  }

  function onUp(upEvent) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (ghost) ghost.remove();
    if (upEvent.type === "pointercancel") return;
    if (!dragging) {
      const start = Math.min(anchor, MAX_END_MINUTES - 30);
      openTaskForm(null, {
        date: day,
        allDay: false,
        startTime: minutesToTime(start),
        endTime: minutesToTime(start + 30),
      });
      return;
    }

    const current = snapMinutes(
      minutesFromClientY(upEvent.clientY, column)
    );
    let start = Math.min(anchor, current);
    let end = Math.max(anchor, current);
    if (end - start < SNAP_MINUTES) {
      end = Math.min(MAX_END_MINUTES, start + 30);
      if (end - start < SNAP_MINUTES) start = Math.max(0, end - 30);
    }
    if (end <= start) return;
    openTaskForm(null, {
      date: day,
      allDay: false,
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
    });
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

// Agenda view

function renderAgenda() {
  const main = el("cal-main");
  main.innerHTML = "";
  const rangeStart = startOfMonth(state.cursor);
  const rangeEnd = endOfMonth(state.cursor);
  const entries = [];

  for (const task of state.tasks) {
    const { start } = taskWindow(task);
    if (start > rangeEnd) continue;
    entries.push({
      task,
      day: start < rangeStart ? rangeStart : startOfDay(start),
    });
  }

  entries.sort((a, b) => {
    const byDay = a.day - b.day;
    if (byDay !== 0) return byDay;
    return sortDayTasks(a.task, b.task);
  });

  const wrapper = document.createElement("div");
  wrapper.className = "cal-agenda";
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "cal-placeholder";
    empty.textContent = "No hay tareas en este periodo.";
    main.appendChild(empty);
    return;
  }

  let currentKey = null;
  let list = null;
  for (const entry of entries) {
    const key = dayKey(entry.day);
    if (key !== currentKey) {
      currentKey = key;
      const section = document.createElement("section");
      section.className = "cal-agenda__day";
      const heading = document.createElement("h3");
      heading.className = "cal-agenda__date";
      heading.textContent = formatLongDate(entry.day);
      list = document.createElement("ul");
      list.className = "cal-agenda__list";
      section.append(heading, list);
      wrapper.appendChild(section);
    }

    const task = entry.task;
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cal-agenda__item";
    if (task.completed) button.classList.add("cal-agenda__item--done");

    const dot = document.createElement("span");
    dot.className = "cal-agenda__dot";
    if (task.color) dot.dataset.color = task.color;

    const time = document.createElement("span");
    time.className = "cal-agenda__time";
    time.textContent = agendaTimeLabel(task);

    const title = document.createElement("span");
    title.className = "cal-agenda__title";
    title.textContent = task.title;

    button.append(dot, time, title);
    button.addEventListener("click", () => openTaskDetails(task));
    item.appendChild(button);
    list.appendChild(item);
  }

  main.appendChild(wrapper);
}

function agendaTimeLabel(task) {
  if (task.all_day) return "Todo el día";
  const { start, end } = taskWindow(task);
  return `${formatTime(start)} – ${formatTime(end)}`;
}

function dayUnderPointer(x, y) {
  const nodes = document.elementsFromPoint(x, y);
  for (const node of nodes) {
    if (node.classList && node.classList.contains("cal-day")) {
      return node.dataset.date;
    }
  }
  return null;
}

function highlightDay(key) {
  document.querySelectorAll(".cal-day--drop").forEach((node) => {
    node.classList.remove("cal-day--drop");
  });
  if (!key) return;
  const cell = document.querySelector(`.cal-day[data-date="${key}"]`);
  if (cell) cell.classList.add("cal-day--drop");
}

function suppressNextClick() {
  state.suppressClick = true;
  window.setTimeout(() => {
    state.suppressClick = false;
  }, 250);
}

function startMovePointer(event, task) {
  if (event.button !== undefined && event.button !== 0) return;
  if (event.target.closest(".cal-event__resize")) return;

  const originKey = dayUnderPointer(event.clientX, event.clientY) || dayKey(parseDate(task.date));
  const startX = event.clientX;
  const startY = event.clientY;
  const node = event.currentTarget;
  const rect = node.getBoundingClientRect();
  let dragging = false;
  let ghost = null;

  function onMove(moveEvent) {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 5) return;
      dragging = true;
      suppressNextClick();
      node.classList.add("cal-event--dragging");
      ghost = node.cloneNode(true);
      ghost.classList.remove("cal-event--dragging");
      ghost.classList.add("cal-event-ghost");
      ghost.setAttribute("aria-hidden", "true");
      ghost.tabIndex = -1;
      ghost.style.position = "fixed";
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`;
      document.body.appendChild(ghost);
    }
    ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    highlightDay(dayUnderPointer(moveEvent.clientX, moveEvent.clientY));
  }

  function onUp(upEvent) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    highlightDay(null);
    if (ghost) ghost.remove();
    node.classList.remove("cal-event--dragging");
    if (upEvent.type === "pointercancel" || !dragging) return;

    const targetKey = dayUnderPointer(upEvent.clientX, upEvent.clientY);
    if (!targetKey) return;
    const delta = diffDays(dateFromKey(originKey), dateFromKey(targetKey));
    if (delta === 0) return;
    void shiftTaskDays(task, delta);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function startResizePointer(event, task) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const node = event.currentTarget.closest(".cal-event");
  let resizing = false;

  function onMove(moveEvent) {
    if (!resizing) {
      if (Math.abs(moveEvent.clientX - startX) < 5) return;
      resizing = true;
      suppressNextClick();
      if (node) node.classList.add("cal-event--dragging");
    }
    highlightDay(dayUnderPointer(moveEvent.clientX, moveEvent.clientY));
  }

  function onUp(upEvent) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    highlightDay(null);
    if (node) node.classList.remove("cal-event--dragging");
    if (upEvent.type === "pointercancel" || !resizing) return;

    const targetKey = dayUnderPointer(upEvent.clientX, upEvent.clientY);
    if (targetKey) void resizeTaskToDay(task, targetKey);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

async function updateTaskDates(task, date, deadline) {
  const previous = { date: task.date, deadline: task.deadline };
  task.date = date;
  task.deadline = deadline;
  renderCalendar();

  try {
    const updated = await updateTask({ ...task });
    Object.assign(task, updated);
    renderCalendar();
    notifyTasksChanged();
  } catch (error) {
    task.date = previous.date;
    task.deadline = previous.deadline;
    renderCalendar();
    setStatus(error.message, "error");
  }
}

function shiftTaskDays(task, delta) {
  const date = addDays(parseDate(task.date), delta);
  const deadline = addDays(parseDate(task.deadline), delta);
  return updateTaskDates(task, date.toISOString(), deadline.toISOString());
}

function resizeTaskToDay(task, targetKey) {
  const start = parseDate(task.date);
  const currentEnd = parseDate(task.deadline);
  const target = dateFromKey(targetKey);
  if (target < startOfDay(start)) return;

  let deadline;
  if (task.all_day) {
    deadline = endOfDay(target);
  } else {
    deadline = new Date(
      target.getFullYear(),
      target.getMonth(),
      target.getDate(),
      currentEnd.getHours(),
      currentEnd.getMinutes(),
      currentEnd.getSeconds(),
      currentEnd.getMilliseconds()
    );
    if (deadline < start) {
      setStatus("La fecha de fin no puede ser anterior al inicio.", "error");
      return;
    }
  }
  return updateTaskDates(task, task.date, deadline.toISOString());
}

// Mini calendar

function renderMini() {
  const container = el("cal-mini");
  if (!container) return;
  container.innerHTML = "";

  const head = document.createElement("div");
  head.className = "cal-mini__head";
  const title = document.createElement("p");
  title.className = "cal-mini__title";
  title.textContent = formatMonthYear(state.cursor);

  const controls = document.createElement("div");
  controls.className = "cal-mini__controls";
  controls.append(
    miniNavButton("Mes anterior", "‹", -1),
    miniNavButton("Mes siguiente", "›", 1)
  );
  head.append(title, controls);
  container.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "cal-mini__grid";
  for (const name of DAY_NAMES) {
    const weekday = document.createElement("span");
    weekday.className = "cal-mini__weekday";
    weekday.textContent = name.charAt(0);
    grid.appendChild(weekday);
  }

  const gridStart = startOfWeek(startOfMonth(state.cursor));
  for (let index = 0; index < MONTH_ROWS * 7; index += 1) {
    const day = addDays(gridStart, index);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cal-mini__day";
    button.textContent = String(day.getDate());
    button.setAttribute("aria-label", formatLongDate(day));
    if (day.getMonth() !== state.cursor.getMonth()) {
      button.classList.add("cal-mini__day--out");
    }
    if (isToday(day)) button.classList.add("cal-mini__day--today");
    if (sameDay(day, state.cursor)) button.classList.add("cal-mini__day--selected");
    button.addEventListener("click", () => {
      state.cursor = startOfDay(day);
      state.dirty = true;
      renderCalendar();
      loadCalendar();
    });
    grid.appendChild(button);
  }
  container.appendChild(grid);
}

function miniNavButton(label, text, delta) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--ghost btn--sm cal-mini__nav";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", () => {
    state.cursor = startOfMonth(addMonths(state.cursor, delta));
    state.dirty = true;
    renderCalendar();
    loadCalendar();
  });
  return button;
}

// Popovers

function closePopover() {
  const popover = el("cal-popover");
  if (!popover) return;
  popover.hidden = true;
  popover.innerHTML = "";
}

function createPopover(titleText) {
  const popover = el("cal-popover");
  popover.hidden = false;
  popover.innerHTML = "";

  const head = document.createElement("div");
  head.className = "cal-popover__head";
  const title = document.createElement("h3");
  title.className = "cal-popover__title";
  title.textContent = titleText;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn--ghost btn--icon cal-popover__close";
  close.setAttribute("aria-label", "Cerrar");
  close.textContent = "×";
  close.addEventListener("click", closePopover);
  head.append(title, close);

  const body = document.createElement("div");
  body.className = "cal-popover__body";
  popover.append(head, body);
  return body;
}

function taskWindow(task) {
  const start = parseDate(task.date);
  let end = task.deadline ? parseDate(task.deadline) : start;
  if (end < start) end = start;
  return { start, end };
}

function taskOverlapsDay(task, day) {
  const { start, end } = taskWindow(task);
  return (
    start.getTime() <= endOfDay(day).getTime() &&
    end.getTime() >= startOfDay(day).getTime()
  );
}

function sortDayTasks(a, b) {
  if (Boolean(a.all_day) !== Boolean(b.all_day)) return a.all_day ? -1 : 1;
  if (Boolean(a.completed) !== Boolean(b.completed)) {
    return a.completed ? 1 : -1;
  }
  return String(a.date).localeCompare(String(b.date));
}

function taskTimeLabel(task, day) {
  if (task.all_day) return "Todo el día";
  const { start, end } = taskWindow(task);
  const startsHere = sameDay(start, day);
  const endsHere = sameDay(end, day);
  if (startsHere && endsHere) {
    return `${formatTime(start)} – ${formatTime(end)}`;
  }
  if (startsHere) return `${formatTime(start)} …`;
  if (endsHere) return `… ${formatTime(end)}`;
  return "Todo el día";
}

function taskRangeLabel(task) {
  const { start, end } = taskWindow(task);
  if (task.all_day) {
    if (sameDay(start, end)) return formatLongDate(start);
    return `${formatLongDate(start)} – ${formatLongDate(end)}`;
  }
  if (sameDay(start, end)) {
    return `${formatLongDate(start)}, ${formatTime(start)} – ${formatTime(end)}`;
  }
  return `${formatLongDate(start)} ${formatTime(start)} – ${formatLongDate(end)} ${formatTime(end)}`;
}

function notifyTasksChanged() {
  document.dispatchEvent(new CustomEvent("taskify:tasks-changed"));
}

function makeButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

function makeInput(type, value = "") {
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  return input;
}

function makeField(labelText, control) {
  const label = document.createElement("label");
  label.className = "field";
  const span = document.createElement("span");
  span.className = "field__label";
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function makeFieldBlock(labelText, control) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const span = document.createElement("span");
  span.className = "field__label";
  span.textContent = labelText;
  wrap.append(span, control);
  return wrap;
}

function setInlineStatus(node, message = "", kind = "info") {
  node.textContent = message;
  if (message) {
    node.dataset.kind = kind;
  } else {
    delete node.dataset.kind;
  }
}

const pad2 = (value) => String(value).padStart(2, "0");

function timeValue(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function makeColorPicker(selected) {
  const wrap = document.createElement("div");
  wrap.className = "cal-colors";
  wrap.setAttribute("role", "radiogroup");
  wrap.setAttribute("aria-label", "Color de la tarea");
  let current = selected || "";

  const options = [{ key: "", label: "Predeterminado" }, ...COLORS];
  for (const color of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cal-color";
    button.dataset.color = color.key;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(current === color.key));
    button.setAttribute("aria-label", color.label);
    button.title = color.label;
    button.addEventListener("click", () => {
      current = color.key;
      wrap.querySelectorAll(".cal-color").forEach((node) => {
        node.setAttribute("aria-checked", String(node === button));
      });
    });
    wrap.appendChild(button);
  }

  return { node: wrap, getValue: () => current || null };
}

function buildTaskPayload(values) {
  const startDay = dateFromKey(values.startDate);
  const endDay = dateFromKey(values.endDate || values.startDate);
  if (endDay < startDay) {
    throw new Error("La fecha de fin debe ser igual o posterior al inicio.");
  }

  let date;
  let deadline;
  if (values.allDay) {
    date = startOfDay(startDay);
    deadline = endOfDay(endDay);
  } else {
    const [startHour, startMinute] = (values.startTime || "09:00")
      .split(":")
      .map(Number);
    const [endHour, endMinute] = (values.endTime || "10:00")
      .split(":")
      .map(Number);
    date = new Date(
      startDay.getFullYear(),
      startDay.getMonth(),
      startDay.getDate(),
      startHour,
      startMinute
    );
    deadline = new Date(
      endDay.getFullYear(),
      endDay.getMonth(),
      endDay.getDate(),
      endHour,
      endMinute
    );
    if (deadline <= date) {
      throw new Error("La hora de fin debe ser posterior al inicio.");
    }
  }

  return {
    id: values.id || null,
    title: values.title,
    description: values.description,
    date: date.toISOString(),
    deadline: deadline.toISOString(),
    all_day: values.allDay,
    completed: values.completed,
    color: values.color,
    category: values.category || null,
  };
}

function openTaskForm(task = null, defaults = {}) {
  const isEdit = Boolean(task);
  const body = createPopover(isEdit ? "Editar tarea" : "Nueva tarea");
  const form = document.createElement("form");
  form.className = "cal-form";
  form.noValidate = true;

  const titleInput = makeInput("text", task ? task.title : "");
  titleInput.required = true;
  titleInput.maxLength = 120;
  titleInput.placeholder = "Título de la tarea";

  const startValue = task
    ? parseDate(task.date)
    : defaults.date
      ? startOfDay(defaults.date)
      : startOfDay(new Date());
  const endValue = task ? parseDate(task.deadline) : startValue;

  const startDateInput = makeInput("date", dayKey(startValue));
  startDateInput.required = true;
  const endDateInput = makeInput("date", dayKey(endValue));
  endDateInput.required = true;

  const allDayInput = makeInput("checkbox");
  allDayInput.checked = task
    ? Boolean(task.all_day)
    : defaults.allDay !== false;
  const allDayLabel = document.createElement("label");
  allDayLabel.className = "cal-toggle";
  allDayLabel.append(allDayInput, document.createTextNode("Todo el día"));

  const startTimeInput = makeInput(
    "time",
    task && !task.all_day
      ? timeValue(startValue)
      : defaults.startTime || "09:00"
  );
  const endTimeInput = makeInput(
    "time",
    task && !task.all_day
      ? timeValue(endValue)
      : defaults.endTime || "10:00"
  );
  startTimeInput.step = "900";
  endTimeInput.step = "900";
  const timeRow = document.createElement("div");
  timeRow.className = "cal-form__row";
  timeRow.append(
    makeField("Hora de inicio", startTimeInput),
    makeField("Hora de fin", endTimeInput)
  );

  const descriptionInput = document.createElement("textarea");
  descriptionInput.rows = 3;
  descriptionInput.value = task ? task.description || "" : "";
  descriptionInput.placeholder = "Descripción (opcional)";

  const categoryInput = makeInput("text", task && task.category ? task.category : "");
  categoryInput.maxLength = 40;
  categoryInput.placeholder = "Categoría (opcional)";

  const completedInput = makeInput("checkbox");
  completedInput.checked = Boolean(task && task.completed);
  const completedLabel = document.createElement("label");
  completedLabel.className = "cal-toggle";
  completedLabel.append(completedInput, document.createTextNode("Completada"));

  const extra = document.createElement("div");
  extra.className = "cal-form__extra";
  extra.hidden = !isEdit;
  extra.append(
    makeField("Fin", endDateInput),
    makeField("Descripción", descriptionInput),
    makeField("Categoría", categoryInput),
    completedLabel
  );

  const colorPicker = makeColorPicker(task ? task.color : "");

  const status = document.createElement("p");
  status.className = "status cal-form__status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const actions = document.createElement("div");
  actions.className = "form__actions";
  const submit = makeButton(
    isEdit ? "Guardar cambios" : "Crear tarea",
    "btn btn--primary"
  );
  submit.type = "submit";
  actions.appendChild(submit);

  if (!isEdit) {
    const more = makeButton("Más opciones", "btn btn--ghost");
    more.addEventListener("click", () => {
      extra.hidden = !extra.hidden;
      more.textContent = extra.hidden ? "Más opciones" : "Menos opciones";
      if (!extra.hidden && endDateInput.value < startDateInput.value) {
        endDateInput.value = startDateInput.value;
      }
    });
    actions.appendChild(more);
  }

  function syncAllDay() {
    timeRow.hidden = allDayInput.checked;
  }
  allDayInput.addEventListener("change", syncAllDay);
  syncAllDay();
  startDateInput.addEventListener("change", () => {
    if (extra.hidden) endDateInput.value = startDateInput.value;
  });

  form.append(
    makeField("Título", titleInput),
    makeField("Inicio", startDateInput),
    allDayLabel,
    timeRow,
    makeFieldBlock("Color", colorPicker.node),
    extra,
    status,
    actions
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const title = titleInput.value.trim();
    if (!title) {
      setInlineStatus(status, "El título es obligatorio.", "error");
      titleInput.focus();
      return;
    }

    submit.disabled = true;
    setInlineStatus(status, isEdit ? "Guardando…" : "Creando…");
    try {
      const payload = buildTaskPayload({
        id: task ? task.id : null,
        title,
        description: descriptionInput.value.trim(),
        category: categoryInput.value.trim(),
        startDate: startDateInput.value,
        endDate: endDateInput.value || startDateInput.value,
        allDay: allDayInput.checked,
        startTime: startTimeInput.value,
        endTime: endTimeInput.value,
        color: colorPicker.getValue(),
        completed: isEdit ? completedInput.checked : false,
      });
      if (isEdit) {
        await updateTask(payload);
      } else {
        await createTask(payload);
      }
      closePopover();
      await loadCalendar();
      notifyTasksChanged();
    } catch (error) {
      setInlineStatus(status, error.message, "error");
    } finally {
      submit.disabled = false;
    }
  });

  body.appendChild(form);
  titleInput.focus();
}

function openDayList(key) {
  const day = dateFromKey(key);
  const tasks = state.tasks
    .filter((task) => taskOverlapsDay(task, day))
    .sort(sortDayTasks);
  const body = createPopover(formatLongDate(day));

  const list = document.createElement("ul");
  list.className = "cal-daylist";

  for (const task of tasks) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cal-daylist__item";
    if (task.completed) button.classList.add("cal-daylist__item--done");

    const dot = document.createElement("span");
    dot.className = "cal-daylist__dot";
    if (task.color) dot.dataset.color = task.color;

    const time = document.createElement("span");
    time.className = "cal-daylist__time";
    time.textContent = taskTimeLabel(task, day);

    const title = document.createElement("span");
    title.className = "cal-daylist__title";
    title.textContent = task.title;

    button.append(dot, time, title);
    button.addEventListener("click", () => openTaskDetails(task));
    item.appendChild(button);
    list.appendChild(item);
  }

  if (tasks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "cal-popover__empty";
    empty.textContent = "No hay tareas este día.";
    body.appendChild(empty);
  } else {
    body.appendChild(list);
  }

  const add = makeButton("Nueva tarea", "btn btn--primary btn--sm", () =>
    openTaskForm(null, { date: day })
  );
  body.appendChild(add);
}

async function toggleTaskCompleted(task) {
  try {
    const updated = await setTaskCompleted(task.id, !task.completed);
    Object.assign(task, updated);
    if (updated.completed) {
      sound.complete();
    } else {
      sound.save();
    }
    closePopover();
    await loadCalendar();
    notifyTasksChanged();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function confirmDeleteTask(task, actions) {
  actions.innerHTML = "";
  const ask = document.createElement("span");
  ask.className = "confirm__ask";
  ask.textContent = "¿Eliminar?";
  const yes = makeButton("Sí, eliminar", "btn btn--danger btn--sm");
  yes.addEventListener("click", async () => {
    yes.disabled = true;
    try {
      await deleteTask(task.id);
      closePopover();
      await loadCalendar();
      notifyTasksChanged();
    } catch (error) {
      setStatus(error.message, "error");
      yes.disabled = false;
    }
  });
  const no = makeButton("Cancelar", "btn btn--ghost btn--sm", () =>
    openTaskDetails(task)
  );
  actions.append(ask, yes, no);
}

function openTaskDetails(task) {
  const body = createPopover(task.title);
  const meta = document.createElement("p");
  meta.className = "cal-detail__meta";
  meta.textContent = taskRangeLabel(task);
  body.appendChild(meta);

  if (task.color) {
    const color = COLORS.find((entry) => entry.key === task.color);
    const chip = document.createElement("span");
    chip.className = "cal-chip cal-chip--color";
    chip.dataset.color = task.color;
    chip.textContent = color ? color.label : task.color;
    body.appendChild(chip);
  }
  if (task.category) {
    const category = document.createElement("span");
    category.className = "cal-chip";
    category.textContent = task.category;
    body.appendChild(category);
  }
  if (task.completed) {
    const badge = document.createElement("span");
    badge.className = "cal-chip cal-chip--done";
    badge.textContent = "Completada";
    body.appendChild(badge);
  }
  if (task.description) {
    const description = document.createElement("p");
    description.className = "cal-detail__desc";
    description.textContent = task.description;
    body.appendChild(description);
  }

  const actions = document.createElement("div");
  actions.className = "cal-detail__actions";
  const complete = makeButton(
    task.completed ? "Marcar como pendiente" : "Completar",
    "btn btn--primary btn--sm",
    () => toggleTaskCompleted(task)
  );
  const edit = makeButton("Editar", "btn btn--ghost btn--sm", () =>
    openTaskForm(task)
  );
  const remove = makeButton("Eliminar", "btn btn--danger btn--sm", () =>
    confirmDeleteTask(task, actions)
  );
  actions.append(complete, edit, remove);
  body.appendChild(actions);
}

// Navigation and events

function navigate(delta) {
  if (state.view === "month" || state.view === "agenda") {
    state.cursor = addMonths(state.cursor, delta);
  } else if (state.view === "week") {
    state.cursor = addDays(state.cursor, delta * 7);
  } else {
    state.cursor = addDays(state.cursor, delta);
  }
  state.dirty = true;
  renderCalendar();
  loadCalendar();
}

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  state.dirty = true;
  renderCalendar();
  loadCalendar();
}

function goToday() {
  state.cursor = startOfDay(new Date());
  state.dirty = true;
  renderCalendar();
  loadCalendar();
}

let resizeTimer = null;

function handleResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const next = maxLanesForWidth();
    if (next === state.maxLanes) return;
    state.maxLanes = next;
    if (state.active) renderCalendar();
  }, 120);
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape") {
    const popover = el("cal-popover");
    if (popover && !popover.hidden) closePopover();
    return;
  }
  if (!state.active || event.metaKey || event.ctrlKey || event.altKey) return;
  if (
    event.target.closest?.(
      "input, textarea, select, [contenteditable='true']"
    )
  ) {
    return;
  }

  const key = event.key.toLowerCase();
  const views = { m: "month", w: "week", d: "day", a: "agenda" };
  if (views[key]) {
    event.preventDefault();
    setView(views[key]);
    return;
  }
  if (key === "t") {
    event.preventDefault();
    goToday();
    return;
  }
  if (key === "arrowleft") {
    event.preventDefault();
    navigate(-1);
  } else if (key === "arrowright") {
    event.preventDefault();
    navigate(1);
  }
}

function handleOutsidePointer(event) {
  const popover = el("cal-popover");
  if (!popover || popover.hidden) return;
  if (popover.contains(event.target)) return;
  closePopover();
}

function toggleSidebar() {
  const calendar = el("cal");
  const hidden = calendar.classList.toggle("cal--sidebar-hidden");
  el("cal-sidebar-toggle").setAttribute("aria-pressed", String(!hidden));
}

export function initCalendar() {
  if (state.initialized) return;
  state.initialized = true;
  state.maxLanes = maxLanesForWidth();

  el("cal-prev").addEventListener("click", () => navigate(-1));
  el("cal-next").addEventListener("click", () => navigate(1));
  el("cal-today").addEventListener("click", goToday);
  el("cal-view").addEventListener("change", (event) => {
    setView(event.target.value);
  });
  el("cal-sidebar-toggle").addEventListener("click", toggleSidebar);

  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("pointerdown", handleOutsidePointer);
  window.addEventListener("resize", handleResize);
  window.setInterval(tickNow, 60_000);
}

export function activateCalendar() {
  initCalendar();
  state.active = true;
  state.maxLanes = maxLanesForWidth();
  renderCalendar();
  if (state.dirty) loadCalendar();
}

export function refreshCalendar() {
  state.dirty = true;
  if (state.active) loadCalendar();
}

export function resetCalendar() {
  state.active = false;
  state.requestId += 1;
  state.tasks = [];
  state.dirty = true;
  state.view = "month";
  state.cursor = startOfDay(new Date());
  state.timeScroll = null;
  closePopover();
}
