const STORAGE_KEY = "study-agile-state-v1";
const SUBJECTS = ["古漢", "現代文", "数学", "英語", "物理", "化学", "歴史", "地理", "公共"];

const elements = {
  date: document.querySelector("#today-date"),
  dateLabel: document.querySelector("#today-label"),
  summary: document.querySelector("#today-summary"),
  tasks: document.querySelector("#today-list"),
  tasksEmpty: document.querySelector("#today-empty"),
  events: document.querySelector("#event-list"),
  eventsEmpty: document.querySelector("#event-empty"),
  futureEvents: document.querySelector("#future-event-list"),
  futureEventsEmpty: document.querySelector("#future-event-empty"),
  eventDialog: document.querySelector("#event-dialog"),
  quizzes: document.querySelector("#quiz-list"),
  quizzesEmpty: document.querySelector("#quiz-empty"),
  quizDialog: document.querySelector("#quiz-dialog"),
  pools: document.querySelector("#pool-list"),
  poolsEmpty: document.querySelector("#pool-empty"),
  goalDialog: document.querySelector("#goal-dialog"),
  poolDialog: document.querySelector("#pool-dialog"),
  taskDialog: document.querySelector("#task-dialog"),
  completeDialog: document.querySelector("#complete-dialog"),
  menuDialog: document.querySelector("#menu-dialog"),
  calendarDialog: document.querySelector("#calendar-dialog"),
  calendarMonth: document.querySelector("#calendar-month"),
  calendarGrid: document.querySelector("#calendar-grid"),
  calendarAgendaTitle: document.querySelector("#calendar-agenda-title"),
  calendarAgenda: document.querySelector("#calendar-agenda-list"),
  calendarAgendaEmpty: document.querySelector("#calendar-agenda-empty"),
};

const today = dateKey(new Date());
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = today;
let state = loadState();
let pendingTaskRecord = null;

function createId() {
  return crypto.randomUUID();
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function addMonths(date, months) {
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), lastDay));
  return result;
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const events = Array.isArray(stored.events) ? stored.events : [];
    const goals = Array.isArray(stored.goals) ? stored.goals : [];
    const ungroupedGoals = goals.filter((goal) => !events.some((event) => event.id === goal.eventId));
    if (ungroupedGoals.length) {
      const legacyEvent = {
        id: createId(),
        title: "イベント未設定の長期計画",
        type: "other",
        start: "",
        end: "",
      };
      events.push(legacyEvent);
      ungroupedGoals.forEach((goal) => { goal.eventId = legacyEvent.id; });
    }
    return {
      events,
      goals,
      quizzes: Array.isArray(stored.quizzes) ? stored.quizzes : [],
      pools: Array.isArray(stored.pools) ? stored.pools : [],
      tasks: Array.isArray(stored.tasks) ? stored.tasks : [],
    };
  } catch (error) {
    console.error("保存データを読み込めませんでした。", error);
    return { events: [], goals: [], quizzes: [], pools: [], tasks: [] };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("データを保存できませんでした。", error);
    window.alert("データを保存できませんでした。ブラウザの空き容量をご確認ください。");
    return false;
  }
  render();
  return true;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatDate(value, options = { month: "numeric", day: "numeric" }) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ja-JP", options).format(new Date(year, month - 1, day));
}

function goalProgress(goal) {
  return Math.min(goal.total * goal.laps, goal.completed);
}

function taskMeetsMinimum(task, amount) {
  return (task.actual || 0) + amount >= task.minimum;
}

function render() {
  const date = new Date();
  elements.date.textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(date);
  elements.dateLabel.textContent = formatDate(today, { month: "long", day: "numeric", weekday: "short" });
  renderTasks();
  renderEvents();
  renderQuizzes();
  renderPools();
  renderSummary();
  renderPoolOptions();
}

function renderSummary() {
  const todaysTasks = state.tasks.filter((task) => task.date === today);
  const completed = todaysTasks.filter((task) => task.completed).length;
  elements.summary.innerHTML = `<span class="stat-number">${completed}<span style="font-size:13px;color:#93a099"> / ${todaysTasks.length}</span></span><span class="stat-caption">今日の完了</span>`;
}

function renderTasks() {
  const tasks = state.tasks.filter((task) => task.date === today);
  elements.tasksEmpty.hidden = tasks.length > 0;
  elements.tasks.innerHTML = tasks.map((task) => {
    const pool = state.pools.find((item) => item.id === task.poolId);
    const unit = pool?.unit || task.unit;
    const title = pool?.title || task.title;
    const subject = pool?.subject || task.subject || "科目未設定";
    const completeLabel = task.completed ? "記録済み" : "実績を記録";
      const recorded = task.actual || 0;
      const achieved = recorded >= task.minimum;
      const surplus = task.completed && achieved && recorded > task.minimum
        ? `<span class="surplus">＋${recorded - task.minimum} ${escapeHtml(unit)} できた！</span>`
      : "";
      const shortfall = !task.completed && !achieved
        ? `<span class="shortfall">あと ${task.minimum - recorded} ${escapeHtml(unit)}</span>`
      : "";
      const taskState = task.completed ? "完了" : achieved ? "最低達成・継続中" : recorded > 0 ? "記録あり" : "未着手";
      const details = task.scope ? ` ・ 範囲: ${escapeHtml(task.scope)}${task.scopeUnit ? ` ${escapeHtml(task.scopeUnit)}` : ""}` : "";
    return `<article class="task-card${task.completed ? " done" : ""}">
      <div class="task-main"><p class="card-title">${escapeHtml(title)}</p>
          <p class="task-detail">${escapeHtml(subject)} ・ ${taskState} ・ 最低 ${task.minimum} ${escapeHtml(unit)} ・ 累計 ${recorded} ${escapeHtml(unit)}${details}</p>
      </div>
        <div class="task-actions">${surplus}${shortfall}${task.completed ? "" : `<button class="task-complete" type="button" data-complete-task="${escapeHtml(task.id)}">${completeLabel}</button>`}</div>
    </article>`;
  }).join("");
}

function renderEvents() {
  const futureThreshold = dateKey(addMonths(new Date(), 2));
  const currentEvents = state.events.filter((event) => !event.start || event.start < futureThreshold);
  const futureEvents = state.events.filter((event) => event.start && event.start >= futureThreshold);
  elements.eventsEmpty.hidden = currentEvents.length > 0;
  elements.futureEventsEmpty.hidden = futureEvents.length > 0;
  elements.events.innerHTML = currentEvents.map(renderEventCard).join("");
  elements.futureEvents.innerHTML = futureEvents.map(renderEventCard).join("");
}

function scheduleEventRefresh() {
  const now = new Date();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  window.setTimeout(() => {
    renderEvents();
    scheduleEventRefresh();
  }, nextDay.getTime() - now.getTime() + 50);
}

function renderEventCard(event) {
  const eventGoals = state.goals.filter((goal) => goal.eventId === event.id);
  const typeLabel = {
    holiday: "長期休暇",
    regular_exam: "定期試験",
    mock_exam: "模擬試験",
    other: "その他",
  }[event.type] || "その他";
  const eventDates = event.start && event.end
    ? `${formatDate(event.start)} — ${formatDate(event.end)}`
    : "日程未設定";
  return `<article class="event-card">
    <div class="event-heading">
      <div class="card-top"><div><p class="card-title">${escapeHtml(event.title)}</p><p class="card-subtitle">${eventDates}</p></div>
        <span class="badge">${typeLabel}</span>
      </div>
      <button class="button button-secondary button-small" type="button" data-add-goal="${escapeHtml(event.id)}">＋ 長期計画を追加</button>
    </div>
    <div class="event-goals">${eventGoals.length
      ? eventGoals.map((goal) => renderGoalCard(goal)).join("")
      : `<p class="muted-empty">このイベントの長期計画はまだありません。</p>`}
    </div>
  </article>`;
}

function renderGoalCard(goal) {
  const total = goal.total * goal.laps;
  const completed = goalProgress(goal);
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const lap = Math.min(goal.laps, Math.floor(completed / goal.total) + 1);
  const status = completed >= total ? "完了" : `${lap}周目 / ${goal.laps}周`;
  const deadline = goal.deadline ? `期限 ${formatDate(goal.deadline)}` : "期限なし";
  return `<article class="goal-card">
    <div class="card-top"><div><p class="card-title">${escapeHtml(goal.title)}</p><p class="card-subtitle">${escapeHtml(goal.subject || "科目未設定")} ・ ${escapeHtml(goal.total)} ${escapeHtml(goal.unit)} × ${escapeHtml(goal.laps)}周 ・ ${deadline}</p></div>
      <span class="badge${percent === 100 ? " complete" : ""}">${status}</span>
    </div>
    <div class="progress-track" role="progressbar" aria-label="${escapeHtml(goal.title)}の進捗" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${percent}%"></div></div>
    <div class="progress-meta"><span>${completed} / ${total} ${escapeHtml(goal.unit)}</span><span>${percent}%</span></div>
  </article>`;
}

function renderQuizzes() {
  const quizzes = [...state.quizzes].sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
  elements.quizzesEmpty.hidden = quizzes.length > 0;
  elements.quizzes.innerHTML = quizzes.map((quiz) => `<article class="quiz-card">
    <div class="quiz-info">
      <p class="card-title">${escapeHtml(quiz.title || "小テスト・提出物")}</p>
      <p class="card-subtitle">${escapeHtml(quiz.scope || "範囲未設定")}${quiz.unit ? ` ${escapeHtml(quiz.unit)}` : ""}</p>
      <div class="quiz-meta"><span>${formatDate(quiz.date, { month: "numeric", day: "numeric", weekday: "short" })}</span><strong>${quiz.period}<span>校時</span></strong><span class="badge">${escapeHtml(quiz.subject)}</span></div>
    </div>
    <div class="quiz-actions">
      <button class="text-button" type="button" data-add-quiz-task="${escapeHtml(quiz.id)}"${state.tasks.some((task) => task.quizId === quiz.id && task.date === today) ? " disabled" : ""}>${state.tasks.some((task) => task.quizId === quiz.id && task.date === today) ? "ToDo作成済み" : "今日のToDoへ"}</button>
      <button class="text-button" type="button" data-duplicate-quiz="${escapeHtml(quiz.id)}">複製</button>
    </div>
  </article>`).join("");
}

function getSchedulesForDate(date) {
  const events = state.events
    .filter((event) => event.start && event.end && event.start <= date && event.end >= date)
    .map((event) => ({ kind: "event", event }));
  const quizzes = state.quizzes
    .filter((quiz) => quiz.date === date)
    .sort((a, b) => a.period - b.period)
    .map((quiz) => ({ kind: "quiz", quiz }));
  return [...events, ...quizzes];
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  elements.calendarMonth.textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" }).format(calendarMonth);
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: firstWeekday }, () => '<span class="calendar-cell calendar-cell-empty" role="presentation"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = dateKey(new Date(year, month, day));
    const schedules = getSchedulesForDate(date);
    const isToday = date === today;
    const selected = date === selectedCalendarDate;
    const scheduleCount = schedules.length;
    cells.push(`<button class="calendar-cell${isToday ? " is-today" : ""}${selected ? " is-selected" : ""}" type="button" role="gridcell" data-calendar-date="${date}" aria-label="${formatDate(date, { year: "numeric", month: "long", day: "numeric", weekday: "long" })}${scheduleCount ? `、予定${scheduleCount}件` : ""}" aria-pressed="${selected}">
      <span class="calendar-day-number">${day}</span>
      ${scheduleCount ? `<span class="calendar-day-count">${scheduleCount}件</span>` : ""}
      ${schedules.slice(0, 2).map((schedule) => `<span class="calendar-marker ${schedule.kind}">${schedule.kind === "event" ? escapeHtml(schedule.event.title) : `${escapeHtml(schedule.quiz.subject)} ${schedule.quiz.period}校時`}</span>`).join("")}
      ${scheduleCount > 2 ? `<span class="calendar-marker-more">ほか${scheduleCount - 2}件</span>` : ""}
    </button>`);
  }
  elements.calendarGrid.innerHTML = cells.join("");
  renderCalendarAgenda();
}

function renderCalendarAgenda() {
  const date = selectedCalendarDate;
  const schedules = getSchedulesForDate(date);
  elements.calendarAgendaTitle.textContent = formatDate(date, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  elements.calendarAgendaEmpty.hidden = schedules.length > 0;
  elements.calendarAgenda.innerHTML = schedules.map((schedule) => {
    if (schedule.kind === "event") {
      return `<article class="agenda-item agenda-event"><span class="agenda-kind">イベント</span><strong>${escapeHtml(schedule.event.title)}</strong></article>`;
    }
    const quiz = schedule.quiz;
    const scope = quiz.scope ? `範囲: ${escapeHtml(quiz.scope)}${quiz.unit ? ` ${escapeHtml(quiz.unit)}` : ""}` : "範囲未設定";
    return `<article class="agenda-item agenda-quiz"><span class="agenda-kind">小テスト・提出物</span><p>${escapeHtml(quiz.subject)} ・ ${quiz.period}校時 ・ ${escapeHtml(quiz.title || "小テスト・提出物")} ・ ${scope}</p></article>`;
  }).join("");
}

function renderPools() {
  elements.poolsEmpty.hidden = state.pools.length > 0;
  const pools = [...state.pools].sort((a, b) => a.start.localeCompare(b.start));
  elements.pools.innerHTML = pools.map((pool) => {
    const remaining = Math.max(0, pool.target - pool.completed);
    const percent = pool.target ? Math.min(100, Math.round(pool.completed / pool.target * 100)) : 0;
    const active = pool.status === "active";
    const buttons = active
      ? `<button class="text-button" type="button" data-add-task="${escapeHtml(pool.id)}">＋ 今日のToDoへ</button>
         <button class="text-button" type="button" data-carry-pool="${escapeHtml(pool.id)}"${remaining === 0 ? " disabled" : ""}>残りを繰り越す</button>`
      : `<span class="badge">終了</span>`;
    return `<article class="pool-card">
      <div class="card-top"><div><p class="card-title">${escapeHtml(pool.title)}</p><p class="card-subtitle">${escapeHtml(pool.subject || "科目未設定")} ・ ${escapeHtml(pool.goalTitle)}から</p></div>
        <span class="badge${remaining === 0 ? " complete" : ""}">${remaining === 0 ? "達成" : `残り ${remaining} ${escapeHtml(pool.unit)}`}</span>
      </div>
      <div class="progress-track" role="progressbar" aria-label="${escapeHtml(pool.title)}の進捗" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${percent}%"></div></div>
      <div class="progress-meta"><span>${pool.completed} / ${pool.target} ${escapeHtml(pool.unit)} 完了</span><span>${percent}%</span></div>
      <div class="card-footer"><span class="date-range">${formatDate(pool.start)} — ${formatDate(pool.end)}</span><div class="pool-actions">${buttons}</div></div>
    </article>`;
  }).join("");
}

function renderPoolOptions() {
  const select = elements.poolDialog.querySelector('[name="goalId"]');
  const activeGoals = state.goals.filter((goal) => goal.completed < goal.total * goal.laps);
  select.innerHTML = activeGoals.length
    ? activeGoals.map((goal) => {
      const event = state.events.find((item) => item.id === goal.eventId);
      return `<option value="${escapeHtml(goal.id)}">${escapeHtml(event?.title || "イベント未設定")} — ${escapeHtml(goal.subject || "科目未設定")} / ${escapeHtml(goal.title)}</option>`;
    }).join("")
    : `<option value="">先にイベント内に長期計画を追加してください</option>`;
  elements.poolDialog.querySelector('[type="submit"]').disabled = activeGoals.length === 0;
}

function showError(form, message) {
  const element = form.querySelector(".form-error");
  element.textContent = message;
  element.classList.toggle("visible", Boolean(message));
}

function openDialog(dialog) {
  const form = dialog.querySelector("form");
  form.reset();
  showError(form, "");
  if (dialog === elements.completeDialog) {
    pendingTaskRecord = null;
    document.querySelector("#task-record-inputs").hidden = false;
    document.querySelector("#task-record-actions").hidden = false;
    document.querySelector("#task-outcome").hidden = true;
  }
  if (dialog === elements.poolDialog) {
    form.elements.start.value = today;
    form.elements.end.value = shiftDate(today, 6);
  }
  if (dialog === elements.eventDialog) {
    form.elements.start.value = today;
    form.elements.end.value = today;
  }
  if (dialog === elements.quizDialog) {
    form.elements.date.value = today;
    updatePeriodWheel(dialog.querySelector("[data-period-wheel]"), 1);
    document.querySelector("#quiz-dialog-title").textContent = "小テスト・提出物予定を追加";
  }
  dialog.showModal();
}

function updatePeriodWheel(wheel, period, behavior = "auto", shouldScroll = true) {
  const options = [...wheel.querySelectorAll("[data-period]")];
  const selectedPeriod = Math.max(1, Math.min(options.length, period));
  options.forEach((option, index) => {
    const selected = index + 1 === selectedPeriod;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-selected", String(selected));
  });
  wheel.closest(".period-picker").querySelector('[name="period"]').value = String(selectedPeriod);
  if (shouldScroll) wheel.scrollTo({ top: (selectedPeriod - 1) * 40, behavior });
}

document.addEventListener("click", (event) => {
  if (event.target.closest(".menu-button")) {
    elements.menuDialog.showModal();
    return;
  }
  if (event.target.closest("[data-menu-calendar]")) {
    elements.menuDialog.close();
    calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    selectedCalendarDate = today;
    renderCalendar();
    elements.calendarDialog.showModal();
    return;
  }
  if (event.target.closest("[data-menu-home]")) {
    elements.menuDialog.close();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const calendarShift = event.target.closest("[data-calendar-shift]");
  if (calendarShift) {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + Number(calendarShift.dataset.calendarShift), 1);
    selectedCalendarDate = dateKey(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1));
    renderCalendar();
    return;
  }
  if (event.target.closest("[data-calendar-today]")) {
    calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    selectedCalendarDate = today;
    renderCalendar();
    return;
  }
  const calendarDay = event.target.closest("[data-calendar-date]");
  if (calendarDay) {
    selectedCalendarDate = calendarDay.dataset.calendarDate;
    renderCalendar();
    return;
  }
  const openButton = event.target.closest("[data-open-dialog]");
  if (openButton) {
    openDialog(document.getElementById(openButton.dataset.openDialog));
    return;
  }
  if (event.target.closest("[data-close-dialog]")) {
    event.target.closest("dialog").close();
    return;
  }
  const periodOption = event.target.closest("[data-period]");
  if (periodOption) {
    updatePeriodWheel(periodOption.closest("[data-period-wheel]"), Number(periodOption.dataset.period), "smooth");
    return;
  }
  const addQuizTaskButton = event.target.closest("[data-add-quiz-task]");
  if (addQuizTaskButton) {
    const quiz = state.quizzes.find((item) => item.id === addQuizTaskButton.dataset.addQuizTask);
    if (!quiz || state.tasks.some((task) => task.quizId === quiz.id && task.date === today)) return;
    state.tasks.push({
      id: createId(),
      quizId: quiz.id,
      title: quiz.title || "小テスト・提出物",
      subject: quiz.subject,
      scope: quiz.scope || "",
      scopeUnit: quiz.unit || "",
      unit: "回",
      minimum: 1,
      actual: 0,
      date: today,
      completed: false,
    });
    saveState();
    return;
  }
  const duplicateQuizButton = event.target.closest("[data-duplicate-quiz]");
  if (duplicateQuizButton) {
    const quiz = state.quizzes.find((item) => item.id === duplicateQuizButton.dataset.duplicateQuiz);
    if (!quiz) return;
    openDialog(elements.quizDialog);
    const form = elements.quizDialog.querySelector("form");
    form.elements.title.value = quiz.title || "";
    form.elements.subject.value = quiz.subject;
    form.elements.date.value = quiz.date;
    form.elements.scope.value = quiz.scope || "";
    form.elements.unit.value = quiz.unit || "";
    updatePeriodWheel(periodWheel, quiz.period);
    document.querySelector("#quiz-dialog-title").textContent = "予定を複製";
    return;
  }
  const addGoalButton = event.target.closest("[data-add-goal]");
  if (addGoalButton) {
    const goalForm = document.querySelector("#goal-form");
    const parentEvent = state.events.find((item) => item.id === addGoalButton.dataset.addGoal);
    if (!parentEvent) return;
    openDialog(elements.goalDialog);
    goalForm.elements.eventId.value = parentEvent.id;
    document.querySelector("#goal-event-title").textContent = `${parentEvent.title} の長期計画`;
    return;
  }
  const taskButton = event.target.closest("[data-add-task]");
  if (taskButton) {
    const pool = state.pools.find((item) => item.id === taskButton.dataset.addTask);
    if (!pool || pool.status !== "active") return;
    const form = document.querySelector("#task-form");
    form.elements.poolId.value = pool.id;
    document.querySelector("#task-pool-title").textContent = `${pool.title}（${pool.unit}）`;
    openDialog(elements.taskDialog);
    form.elements.poolId.value = pool.id;
    return;
  }
  const completeButton = event.target.closest("[data-complete-task]");
  if (completeButton) {
    const task = state.tasks.find((item) => item.id === completeButton.dataset.completeTask);
    if (!task || task.completed) return;
    const pool = state.pools.find((item) => item.id === task.poolId);
    const form = document.querySelector("#complete-form");
    form.elements.taskId.value = task.id;
    form.elements.actual.value = Math.max(0, task.minimum - (task.actual || 0));
    document.querySelector("#complete-task-title").textContent = `${task.title} — 最低 ${task.minimum} ${pool?.unit || task.unit}`;
    openDialog(elements.completeDialog);
    form.elements.taskId.value = task.id;
    form.elements.actual.value = Math.max(0, task.minimum - (task.actual || 0));
    return;
  }
  const outcomeButton = event.target.closest("[data-task-outcome]");
  if (outcomeButton) {
    if (!pendingTaskRecord) return;
    commitTaskRecord(pendingTaskRecord.taskId, pendingTaskRecord.amount, outcomeButton.dataset.taskOutcome === "complete");
    pendingTaskRecord = null;
    if (saveState()) elements.completeDialog.close();
    return;
  }
  const carryButton = event.target.closest("[data-carry-pool]");
  if (carryButton) carryPool(carryButton.dataset.carryPool);
});

const periodWheel = elements.quizDialog.querySelector("[data-period-wheel]");
periodWheel.addEventListener("scroll", () => {
  const selectedPeriod = Math.round(periodWheel.scrollTop / 40) + 1;
  updatePeriodWheel(periodWheel, selectedPeriod, "auto", false);
});
periodWheel.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = Number(elements.quizDialog.querySelector('[name="period"]').value);
  const next = event.key === "Home" ? 1 : event.key === "End" ? 5 : current + (event.key === "ArrowDown" ? 1 : -1);
  updatePeriodWheel(periodWheel, next, "smooth");
});

document.querySelectorAll(".quick-amounts").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add]");
    if (!button) return;
    const input = group.closest("form").elements[group.dataset.target];
    input.value = Math.max(0, Number(input.value || 0) + Number(button.dataset.add));
    input.focus();
  });
});

document.querySelector("#quiz-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const title = String(data.get("title")).trim();
  const subject = String(data.get("subject"));
  const date = String(data.get("date"));
  const scope = String(data.get("scope")).trim();
  const unit = String(data.get("unit")).trim();
  const period = Number(data.get("period"));
  if (!title || !SUBJECTS.includes(subject) || !date || !scope || !Number.isInteger(period) || period < 1 || period > 5) {
    showError(form, "タイトル・範囲・科目・日付・1〜5校時を正しく入力してください。");
    return;
  }
  state.quizzes.push({ id: createId(), title, subject, date, scope, unit, period });
  if (saveState()) elements.quizDialog.close();
});

document.querySelector("#event-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const title = String(data.get("title")).trim();
  const start = String(data.get("start"));
  const end = String(data.get("end"));
  if (!title || start > end) {
    showError(form, "イベント名と期間を正しく入力してください。");
    return;
  }
  state.events.push({
    id: createId(),
    title,
    type: String(data.get("type")),
    start,
    end,
  });
  if (saveState()) elements.eventDialog.close();
});

document.querySelector("#goal-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const parentEvent = state.events.find((item) => item.id === data.get("eventId"));
  const goal = {
    id: createId(),
    eventId: parentEvent?.id,
    subject: String(data.get("subject")),
    title: String(data.get("title")).trim(),
    unit: String(data.get("unit")).trim(),
    total: Number(data.get("total")),
    laps: Number(data.get("laps")),
    completed: 0,
    deadline: String(data.get("deadline") || ""),
  };
  if (!parentEvent || !SUBJECTS.includes(goal.subject) || !goal.title || !goal.unit || !Number.isSafeInteger(goal.total) || goal.total < 1 || !Number.isSafeInteger(goal.laps) || goal.laps < 1) {
    showError(form, "イベント・科目を選択し、教材名・単位・量を正しく入力してください。");
    return;
  }
  state.goals.push(goal);
  if (saveState()) elements.goalDialog.close();
});

document.querySelector("#pool-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const goal = state.goals.find((item) => item.id === data.get("goalId"));
  const target = Number(data.get("target"));
  const start = String(data.get("start"));
  const end = String(data.get("end"));
  if (!goal || goal.completed >= goal.total * goal.laps) {
    showError(form, "有効な長期目標を選択してください。");
    return;
  }
  if (!Number.isSafeInteger(target) || target < 1 || start > end) {
    showError(form, "目標量と期間を正しく入力してください。");
    return;
  }
  state.pools.push({
    id: createId(), eventId: goal.eventId, goalId: goal.id, goalTitle: goal.title, title: goal.title, subject: goal.subject,
    unit: goal.unit, start, end, target, completed: 0, status: "active",
  });
  if (saveState()) elements.poolDialog.close();
});

document.querySelector("#task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const pool = state.pools.find((item) => item.id === form.elements.poolId.value);
  const minimum = Number(form.elements.minimum.value);
  if (!pool || pool.status !== "active" || !Number.isSafeInteger(minimum) || minimum < 1) {
    showError(form, "最低量を正しく入力してください。");
    return;
  }
  state.tasks.push({ id: createId(), poolId: pool.id, title: pool.title, subject: pool.subject, unit: pool.unit, minimum, date: today, completed: false });
  if (saveState()) elements.taskDialog.close();
});

document.querySelector("#complete-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const task = state.tasks.find((item) => item.id === form.elements.taskId.value);
  const pool = task && state.pools.find((item) => item.id === task.poolId);
  const actual = Number(form.elements.actual.value);
  if (!task || task.completed || !Number.isSafeInteger(actual) || actual < 0) {
    showError(form, "実績量を0以上の整数で入力してください。");
    return;
  }
  if (!taskMeetsMinimum(task, actual)) {
    commitTaskRecord(task.id, actual, false);
    if (saveState()) elements.completeDialog.close();
    return;
  }
  pendingTaskRecord = { taskId: task.id, amount: actual };
  document.querySelector("#task-record-inputs").hidden = true;
  document.querySelector("#task-record-actions").hidden = true;
  document.querySelector("#task-outcome").hidden = false;
});

function commitTaskRecord(taskId, amount, complete) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.completed) return;
  task.actual = (task.actual || 0) + amount;
  task.completed = complete;
  const pool = state.pools.find((item) => item.id === task.poolId);
  if (!pool) return;
  pool.completed += amount;
  const goal = state.goals.find((item) => item.id === pool.goalId);
  if (goal) goal.completed = Math.min(goal.total * goal.laps, goal.completed + amount);
}

function carryPool(poolId) {
  const pool = state.pools.find((item) => item.id === poolId);
  if (!pool || pool.status !== "active") return;
  const remaining = Math.max(0, pool.target - pool.completed);
  if (!remaining) return;
  const nextStart = shiftDate(pool.end, 1);
  pool.status = "closed";
  state.pools.push({
    ...pool,
    id: createId(),
    start: nextStart,
    end: shiftDate(nextStart, 6),
    target: remaining,
    completed: 0,
    status: "active",
  });
  saveState();
}

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

render();
scheduleEventRefresh();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("オフライン機能を有効にできませんでした。", error);
    });
  });
}
