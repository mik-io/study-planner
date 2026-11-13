const STORAGE_KEY = "study-agile-state-v1";

const elements = {
  date: document.querySelector("#today-date"),
  dateLabel: document.querySelector("#today-label"),
  summary: document.querySelector("#today-summary"),
  tasks: document.querySelector("#today-list"),
  tasksEmpty: document.querySelector("#today-empty"),
  goals: document.querySelector("#goal-list"),
  goalsEmpty: document.querySelector("#goal-empty"),
  pools: document.querySelector("#pool-list"),
  poolsEmpty: document.querySelector("#pool-empty"),
  goalDialog: document.querySelector("#goal-dialog"),
  poolDialog: document.querySelector("#pool-dialog"),
  taskDialog: document.querySelector("#task-dialog"),
  completeDialog: document.querySelector("#complete-dialog"),
};

const today = dateKey(new Date());
let state = loadState();

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

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      goals: Array.isArray(stored.goals) ? stored.goals : [],
      pools: Array.isArray(stored.pools) ? stored.pools : [],
      tasks: Array.isArray(stored.tasks) ? stored.tasks : [],
    };
  } catch (error) {
    console.error("保存データを読み込めませんでした。", error);
    return { goals: [], pools: [], tasks: [] };
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

function render() {
  const date = new Date();
  elements.date.textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(date);
  elements.dateLabel.textContent = formatDate(today, { month: "long", day: "numeric", weekday: "short" });
  renderTasks();
  renderGoals();
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
    const completeLabel = task.completed ? "記録済み" : "実績を記録";
    const achieved = task.completed && task.actual >= task.minimum;
    const surplus = achieved && task.actual > task.minimum
      ? `<span class="surplus">＋${task.actual - task.minimum} ${escapeHtml(unit)} できた！</span>`
      : "";
    const shortfall = task.completed && !achieved
      ? `<span class="shortfall">あと ${task.minimum - task.actual} ${escapeHtml(unit)}</span>`
      : "";
    return `<article class="task-card${task.completed ? " done" : ""}">
      <div class="task-main"><p class="card-title">${escapeHtml(title)}</p>
        <p class="task-detail">${task.completed
          ? `${achieved ? "達成" : "未達"} ・ 最低 ${task.minimum} ${escapeHtml(unit)} ・ 実績 ${task.actual} ${escapeHtml(unit)}`
          : `最低 ${task.minimum} ${escapeHtml(unit)} をやってみよう`}</p>
      </div>
      <div class="task-actions">${surplus}${shortfall}<button class="task-complete" type="button" data-complete-task="${escapeHtml(task.id)}"${task.completed ? " disabled" : ""}>${completeLabel}</button></div>
    </article>`;
  }).join("");
}

function renderGoals() {
  elements.goalsEmpty.hidden = state.goals.length > 0;
  elements.goals.innerHTML = state.goals.map((goal) => {
    const total = goal.total * goal.laps;
    const completed = goalProgress(goal);
    const percent = total ? Math.round((completed / total) * 100) : 0;
    const lap = Math.min(goal.laps, Math.floor(completed / goal.total) + 1);
    const status = completed >= total ? "完了" : `${lap}周目 / ${goal.laps}周`;
    const deadline = goal.deadline ? `期限 ${formatDate(goal.deadline)}` : "期限なし";
    return `<article class="goal-card">
      <div class="card-top"><div><p class="card-title">${escapeHtml(goal.title)}</p><p class="card-subtitle">${escapeHtml(goal.total)} ${escapeHtml(goal.unit)} × ${escapeHtml(goal.laps)}周 ・ ${deadline}</p></div>
        <span class="badge${percent === 100 ? " complete" : ""}">${status}</span>
      </div>
      <div class="progress-track" role="progressbar" aria-label="${escapeHtml(goal.title)}の進捗" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${percent}%"></div></div>
      <div class="progress-meta"><span>${completed} / ${total} ${escapeHtml(goal.unit)}</span><span>${percent}%</span></div>
    </article>`;
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
      <div class="card-top"><div><p class="card-title">${escapeHtml(pool.title)}</p><p class="card-subtitle">${escapeHtml(pool.goalTitle)}から</p></div>
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
    ? activeGoals.map((goal) => `<option value="${escapeHtml(goal.id)}">${escapeHtml(goal.title)}</option>`).join("")
    : `<option value="">先に長期目標を追加してください</option>`;
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
  if (dialog === elements.poolDialog) {
    form.elements.start.value = today;
    form.elements.end.value = shiftDate(today, 6);
  }
  dialog.showModal();
}

document.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-open-dialog]");
  if (openButton) {
    openDialog(document.getElementById(openButton.dataset.openDialog));
    return;
  }
  if (event.target.closest("[data-close-dialog]")) {
    event.target.closest("dialog").close();
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
    form.elements.actual.value = task.minimum;
    document.querySelector("#complete-task-title").textContent = `${pool?.title || task.title} — 最低 ${task.minimum} ${pool?.unit || task.unit}`;
    openDialog(elements.completeDialog);
    form.elements.taskId.value = task.id;
    form.elements.actual.value = task.minimum;
    return;
  }
  const carryButton = event.target.closest("[data-carry-pool]");
  if (carryButton) carryPool(carryButton.dataset.carryPool);
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

document.querySelector("#goal-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const goal = {
    id: createId(),
    title: String(data.get("title")).trim(),
    unit: String(data.get("unit")).trim(),
    total: Number(data.get("total")),
    laps: Number(data.get("laps")),
    completed: 0,
    deadline: String(data.get("deadline") || ""),
  };
  if (!goal.title || !goal.unit || !Number.isSafeInteger(goal.total) || goal.total < 1 || !Number.isSafeInteger(goal.laps) || goal.laps < 1) {
    showError(form, "教材名・単位・量を正しく入力してください。");
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
    id: createId(), goalId: goal.id, goalTitle: goal.title, title: goal.title,
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
  state.tasks.push({ id: createId(), poolId: pool.id, title: pool.title, unit: pool.unit, minimum, date: today, completed: false });
  if (saveState()) elements.taskDialog.close();
});

document.querySelector("#complete-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const task = state.tasks.find((item) => item.id === form.elements.taskId.value);
  const pool = task && state.pools.find((item) => item.id === task.poolId);
  const actual = Number(form.elements.actual.value);
  if (!task || task.completed || !pool || !Number.isSafeInteger(actual) || actual < 0) {
    showError(form, "実績量を0以上の整数で入力してください。");
    return;
  }
  task.completed = true;
  task.actual = actual;
  pool.completed += actual;
  const goal = state.goals.find((item) => item.id === pool.goalId);
  if (goal) goal.completed = Math.min(goal.total * goal.laps, goal.completed + actual);
  if (saveState()) elements.completeDialog.close();
});

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

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("オフライン機能を有効にできませんでした。", error);
    });
  });
}
