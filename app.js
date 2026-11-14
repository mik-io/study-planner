import { firebaseConfig } from "./firebase-config.js";

const LEGACY_STORAGE_KEY = "study-agile-state-v1";
const STORAGE_KEY_PREFIX = "study-agile-state-v1:";
const PENDING_WRITE_PREFIX = "study-agile-pending-write-v1:";
const FIREBASE_VERSION = "11.10.0";
const SUBJECTS = ["古漢", "現代文", "数学", "英語", "物理", "化学", "歴史", "地理", "公共"];

const elements = {
  authScreen: document.querySelector("#auth-screen"),
  authMessage: document.querySelector("#auth-message"),
  authUser: document.querySelector("#auth-user"),
  syncStatus: document.querySelector("#sync-status"),
  signInButtons: document.querySelectorAll("[data-google-sign-in]"),
  signOutButton: document.querySelector("#google-sign-out"),
  retryButton: document.querySelector("[data-auth-retry]"),
  dashboard: document.querySelector("#dashboard"),
  syncError: document.querySelector("#sync-error"),
  syncErrorMessage: document.querySelector("#sync-error-message"),
  retrySyncButton: document.querySelector("#retry-sync"),
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
let state = emptyState();
let pendingTaskRecord = null;
let currentUser = null;
let firebaseAuth = null;
let firebaseAuthApi = null;
let firestoreDb = null;
let firestoreStateRef = null;
let firestoreApi = null;
let saveQueue = Promise.resolve();
let legacyDataPendingMigration = false;
let authLoadGeneration = 0;
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
  const [year, month, day] = dateString.split("-").map(Number);  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function addMonths(date, months) {
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), lastDay));
  return result;
}

function emptyState() {
  return { events: [], goals: [], quizzes: [], pools: [], tasks: [] };
}

function normalizeState(stored) {
  stored = stored && typeof stored === "object" ? stored : {};
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
}

function readLocalState(key) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : normalizeState(JSON.parse(value));
  } catch (error) {
    console.error("保存データを読み込めませんでした。", error);
    throw new Error("このブラウザに保存されたデータを読み込めませんでした。", { cause: error });
  }
}

function saveState() {
  if (!currentUser || !firestoreStateRef) return false;
  const updatedAt = Date.now();
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${currentUser.uid}`, JSON.stringify(state));
    localStorage.setItem(`${PENDING_WRITE_PREFIX}${currentUser.uid}`, String(updatedAt));
  } catch (error) {
    console.error("データを保存できませんでした。", error);
    setAuthMessage("この端末の一時保存に失敗しました。クラウドへの保存を試みています。", true);
  }
  render();
  const user = currentUser;
  const stateRef = firestoreStateRef;
  const snapshot = JSON.parse(JSON.stringify(state));
  queueCloudWrite(user, stateRef, snapshot, updatedAt);
  return true;
}

function queueCloudWrite(user, stateRef, data, updatedAt) {
  saveQueue = saveQueue
    .then(() => writeCloudState(stateRef, data, updatedAt))
    .then(() => {
      clearPendingWrite(user.uid, updatedAt);
      if (currentUser?.uid === user.uid) setAuthMessage("同期済み");
      if (legacyDataPendingMigration) {
        removeLegacyData();
        legacyDataPendingMigration = false;
      }
    })
    .catch((error) => {
      console.error("Firestoreへのデータ保存に失敗しました。", error);
      if (currentUser?.uid === user.uid) {
        setAuthMessage("クラウドへの同期に失敗しました。通信状態を確認して再同期してください。", true);
      }
    });
  return saveQueue;
}

async function writeCloudState(stateRef, data, updatedAt = Date.now()) {
  await firestoreApi.setDoc(stateRef, {
    state: data,
    clientUpdatedAt: updatedAt,
    updatedAt: firestoreApi.serverTimestamp(),
  });
}

function clearPendingWrite(uid, updatedAt) {
  const key = `${PENDING_WRITE_PREFIX}${uid}`;
  try {
    if (Number(localStorage.getItem(key)) === updatedAt) localStorage.removeItem(key);
  } catch (error) {
    console.error("同期済み状態を更新できませんでした。", error);
  }
}

function removeLegacyData() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    console.error("移行済みデータをブラウザから削除できませんでした。", error);
  }
}

function setAuthMessage(message, isError = false) {
  elements.authMessage.textContent = message;
  elements.authMessage.classList.toggle("error", isError);
  elements.syncStatus.textContent = message;
  elements.syncStatus.classList.toggle("error", isError);
  elements.syncErrorMessage.textContent = message;
  elements.syncError.hidden = !isError || !currentUser || elements.dashboard.hidden;
}

function setAuthenticatedView(isReady) {
  elements.authScreen.hidden = isReady;
  elements.dashboard.hidden = !isReady;
  elements.authUser.hidden = !currentUser;
  elements.authUser.textContent = currentUser?.displayName || currentUser?.email || "";
  elements.authUser.title = currentUser?.email || "";
  elements.syncStatus.hidden = !currentUser;
  elements.signOutButton.hidden = !currentUser;
  elements.signInButtons.forEach((button) => {
    button.hidden = Boolean(currentUser);
    button.disabled = !firebaseAuth || Boolean(currentUser);
  });
  elements.retryButton.hidden = !currentUser || isReady;
}

function isFirebaseConfigured() {
  return ["apiKey", "authDomain", "projectId", "appId"].every((key) => (
    typeof firebaseConfig[key] === "string" && firebaseConfig[key].trim().length > 0
  ));
}

function getAccountLoadErrorMessage(error) {
  if (error?.code === "permission-denied") {
    return "Firestoreへのアクセスが拒否されました。Firebase ConsoleでプロジェクトとFirestoreルールの公開状態を確認してください。 (permission-denied)";
  }
  if (error?.code === "unavailable") {
    return "Firestoreに接続できません。通信状態を確認して再読み込みしてください。 (unavailable)";
  }
  if (error?.code === "failed-precondition") {
    return "Firestoreの設定を確認できませんでした。Firebase ConsoleでFirestore Databaseが作成済みか確認してください。 (failed-precondition)";
  }
  const errorCode = typeof error?.code === "string" ? ` (${error.code})` : "";
  return `データを読み込めませんでした。通信状態を確認し、再読み込みしてください。${errorCode}`;
}

async function loadUserState(user) {
  const generation = ++authLoadGeneration;
  currentUser = user;
  firestoreStateRef = null;
  state = emptyState();
  setAuthenticatedView(false);
  setAuthMessage("アカウントのデータを読み込んでいます。");
  try {
    const stateRef = firestoreApi.doc(firestoreDb, "users", user.uid, "planner", "state");
    const remoteSnapshot = await firestoreApi.getDoc(stateRef);
    if (generation !== authLoadGeneration) return;

    let shouldSeedCloud = false;
    let cloudWriteAt = Date.now();
    if (remoteSnapshot.exists()) {
      const remoteData = remoteSnapshot.data();
      const pendingAt = Number(localStorage.getItem(`${PENDING_WRITE_PREFIX}${user.uid}`) || 0);
      const remoteUpdatedAt = Number(remoteData.clientUpdatedAt || 0);
      const cachedState = pendingAt > remoteUpdatedAt
        ? readLocalState(`${STORAGE_KEY_PREFIX}${user.uid}`)
        : null;
      if (cachedState) {
        state = cachedState;
        shouldSeedCloud = true;
        cloudWriteAt = pendingAt;
      } else {
        state = normalizeState(remoteData.state);
      }
    } else {
      const cachedState = readLocalState(`${STORAGE_KEY_PREFIX}${user.uid}`);
      if (cachedState) {
        state = cachedState;
        shouldSeedCloud = true;
      } else {
        const legacyState = readLocalState(LEGACY_STORAGE_KEY);
        if (legacyState) {
          state = legacyState;
          legacyDataPendingMigration = true;
          shouldSeedCloud = true;
        }
      }
    }

    firestoreStateRef = stateRef;
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${user.uid}`, JSON.stringify(state));
    } catch (error) {
      console.error("データの一時保存に失敗しました。", error);
    }

    if (shouldSeedCloud) {
      await writeCloudState(stateRef, state, cloudWriteAt);
      clearPendingWrite(user.uid, cloudWriteAt);
      if (legacyDataPendingMigration) {
        removeLegacyData();
        legacyDataPendingMigration = false;
      }
    }
    if (generation !== authLoadGeneration) return;
    setAuthenticatedView(true);
    setAuthMessage("同期済み");
    render();
  } catch (error) {
    console.error("アカウントのデータを読み込めませんでした。", error);
    if (generation !== authLoadGeneration) return;
    setAuthenticatedView(false);
    setAuthMessage(getAccountLoadErrorMessage(error), true);
  }
}

async function initializeAuth() {
  if (!isFirebaseConfigured()) {
    setAuthMessage("Firebaseの設定が必要です。READMEの「Firebaseの設定」を参照してください。", true);
    return;
  }
  try {
    const [appApi, authApi, dbApi] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
    ]);
    const app = appApi.initializeApp(firebaseConfig);
    firebaseAuth = authApi.getAuth(app);
    firebaseAuthApi = authApi;
    firestoreDb = dbApi.getFirestore(app);
    firestoreApi = dbApi;
    elements.signInButtons.forEach((button) => { button.disabled = false; });
    setAuthMessage("Googleアカウントでログインしてください。初回利用時は自動で新規登録されます。");
    authApi.onAuthStateChanged(firebaseAuth, (user) => {
      if (user) {
        loadUserState(user);
      } else {
        authLoadGeneration += 1;
        currentUser = null;
        firestoreStateRef = null;
        state = emptyState();
        legacyDataPendingMigration = false;
        setAuthenticatedView(false);
        setAuthMessage("Googleアカウントでログインしてください。初回利用時は自動で新規登録されます。");
      }
    });
  } catch (error) {
    console.error("Firebaseを初期化できませんでした。", error);
    setAuthMessage("Firebaseを初期化できませんでした。設定とネットワークを確認してください。", true);
  }
}

elements.signInButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!firebaseAuth || !firebaseAuthApi) return;
    elements.signInButtons.forEach((signInButton) => { signInButton.disabled = true; });
    setAuthMessage("Googleアカウントでログインまたは新規登録しています。");
    try {
      await firebaseAuthApi.signInWithPopup(firebaseAuth, new firebaseAuthApi.GoogleAuthProvider());
    } catch (error) {
      console.error("Googleログインに失敗しました。", error);
      setAuthMessage("Googleログインに失敗しました。もう一度お試しください。", true);
    } finally {
      elements.signInButtons.forEach((signInButton) => {
        signInButton.disabled = !firebaseAuth || Boolean(currentUser);
      });
    }
  });
});

elements.signOutButton.addEventListener("click", async () => {
  if (!firebaseAuth || !firebaseAuthApi) return;
  elements.signOutButton.disabled = true;
  try {
    await firebaseAuthApi.signOut(firebaseAuth);
  } catch (error) {
    console.error("ログアウトに失敗しました。", error);
    setAuthMessage("ログアウトに失敗しました。もう一度お試しください。", true);
  } finally {
    elements.signOutButton.disabled = false;
  }
});

elements.retryButton.addEventListener("click", () => {
  if (currentUser) loadUserState(currentUser);
});

elements.retrySyncButton.addEventListener("click", () => {
  if (!currentUser || !firestoreStateRef) return;
  const user = currentUser;
  const updatedAt = Date.now();
  try {
    localStorage.setItem(`${PENDING_WRITE_PREFIX}${user.uid}`, String(updatedAt));
  } catch (error) {
    console.error("再同期状態を一時保存できませんでした。", error);
  }
  queueCloudWrite(user, firestoreStateRef, JSON.parse(JSON.stringify(state)), updatedAt);
});

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
        <div class="task-actions"><button class="text-button" type="button" data-edit-task="${escapeHtml(task.id)}">編集</button>${surplus}${shortfall}${task.completed ? "" : `<button class="task-complete" type="button" data-complete-task="${escapeHtml(task.id)}">${completeLabel}</button>`}</div>
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
      <div class="event-actions"><button class="text-button" type="button" data-edit-event="${escapeHtml(event.id)}">編集</button><button class="button button-secondary button-small" type="button" data-add-goal="${escapeHtml(event.id)}">＋ 長期計画を追加</button></div>
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
      <div class="goal-actions"><span class="badge${percent === 100 ? " complete" : ""}">${status}</span><button class="text-button" type="button" data-edit-goal="${escapeHtml(goal.id)}">編集</button></div>
    </div>
    <div class="progress-track" role="progressbar" aria-label="${escapeHtml(goal.title)}の進捗" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${percent}%"></div></div>
    <div class="progress-meta"><span>${completed} / ${total} ${escapeHtml(goal.unit)}</span><span>${percent}%</span></div>
  </article>`;
}

function renderQuizzes() {
  const quizzes = [...state.quizzes].sort((a, b) => a.date.localeCompare(b.date) || (a.period || 99) - (b.period || 99));
  elements.quizzesEmpty.hidden = quizzes.length > 0;
  elements.quizzes.innerHTML = quizzes.map((quiz) => `<article class="quiz-card">
    <div class="quiz-info">
      <p class="card-title">${escapeHtml(quiz.title || "小テスト・提出物")}</p>
      <p class="card-subtitle">${escapeHtml(quiz.scope || "範囲未設定")}${quiz.unit ? ` ${escapeHtml(quiz.unit)}` : ""}</p>
      <div class="quiz-meta"><span>${formatDate(quiz.date, { month: "numeric", day: "numeric", weekday: "short" })}</span>${quiz.period ? `<strong>${quiz.period}<span>校時</span></strong>` : ""}<span class="badge">${escapeHtml(quiz.subject)}</span><span class="badge">${quiz.kind === "submission" ? "提出物" : "小テスト"}</span></div>
    </div>
    <div class="quiz-actions">
      <button class="text-button" type="button" data-edit-quiz="${escapeHtml(quiz.id)}">編集</button>
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
    .sort((a, b) => (a.period || 99) - (b.period || 99))
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
      ${schedules.slice(0, 2).map((schedule) => `<span class="calendar-marker ${schedule.kind}">${schedule.kind === "event" ? escapeHtml(schedule.event.title) : `${escapeHtml(schedule.quiz.subject)}${schedule.quiz.period ? ` ${schedule.quiz.period}校時` : ""} ${schedule.quiz.kind === "submission" ? "提出物" : "小テスト"}`}</span>`).join("")}
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
    const kind = quiz.kind === "submission" ? "提出物" : "小テスト";
    const period = quiz.period ? ` ・ ${quiz.period}校時` : "";
    return `<article class="agenda-item agenda-quiz"><span class="agenda-kind">${kind}</span><p>${escapeHtml(quiz.subject)}${period} ・ ${escapeHtml(quiz.title || kind)} ・ ${scope}</p></article>`;
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
      <div class="card-footer"><span class="date-range">${formatDate(pool.start)} — ${formatDate(pool.end)}</span><div class="pool-actions"><button class="text-button" type="button" data-edit-pool="${escapeHtml(pool.id)}">編集</button>${buttons}</div></div>
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
  if (form) {
    form.reset();
    delete form.dataset.editId;
    const heading = form.querySelector(".modal-heading h2");
    const submit = form.querySelector('[type="submit"]');
    if (heading) {
      heading.dataset.defaultText ||= heading.textContent;
      heading.textContent = heading.dataset.defaultText;
    }
    if (submit) {
      submit.dataset.defaultText ||= submit.textContent;
      submit.textContent = submit.dataset.defaultText;
    }
  }
  if (form) showError(form, "");
  if (dialog === elements.completeDialog) {
    pendingTaskRecord = null;
    document.querySelector("#task-record-inputs").hidden = false;
    document.querySelector("#task-record-actions").hidden = false;
    document.querySelector("#task-outcome").hidden = true;
  }
  if (dialog === elements.poolDialog) {
    form.elements.goalId.disabled = false;
    form.elements.goalId.required = true;
    form.elements.start.value = today;
    form.elements.end.value = shiftDate(today, 6);
  }
  if (dialog === elements.eventDialog) {
    form.elements.start.value = today;
    form.elements.end.value = today;
  }
  if (dialog === elements.quizDialog) {
    form.elements.date.value = today;
    setScheduleType(form, "quiz");
    form.elements.period.value = "";
    document.querySelector("#quiz-dialog-title").textContent = "予定を追加";
  }
  dialog.showModal();
}

function openEditDialog(dialog, record, heading, submitLabel) {
  openDialog(dialog);
  const form = dialog.querySelector("form");
  form.dataset.editId = record.id;
  form.querySelector(".modal-heading h2").textContent = heading;
  form.querySelector('[type="submit"]').textContent = submitLabel;
  return form;
}

function setScheduleType(form, kind) {
  form.elements.kind.value = kind;
  const isQuiz = kind === "quiz";
  const period = form.elements.period;
  period.required = isQuiz;
  period.disabled = !isQuiz;
  document.querySelector("#period-field").hidden = !isQuiz;
  form.querySelectorAll("[data-schedule-type]").forEach((button) => {
    const selected = button.dataset.scheduleType === kind;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
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
  const editEventButton = event.target.closest("[data-edit-event]");
  if (editEventButton) {
    const item = state.events.find((eventItem) => eventItem.id === editEventButton.dataset.editEvent);
    if (!item) return;
    const form = openEditDialog(elements.eventDialog, item, "イベントを編集", "変更を保存");
    form.elements.title.value = item.title;
    form.elements.type.value = item.type;
    form.elements.start.value = item.start;
    form.elements.end.value = item.end;
    return;
  }
  const editGoalButton = event.target.closest("[data-edit-goal]");
  if (editGoalButton) {
    const item = state.goals.find((goal) => goal.id === editGoalButton.dataset.editGoal);
    if (!item) return;
    const form = openEditDialog(elements.goalDialog, item, "長期目標を編集", "変更を保存");
    form.elements.eventId.value = item.eventId;
    form.elements.subject.value = item.subject;
    form.elements.title.value = item.title;
    form.elements.unit.value = item.unit;
    form.elements.total.value = item.total;
    form.elements.laps.value = item.laps;
    form.elements.deadline.value = item.deadline || "";
    const parentEvent = state.events.find((eventItem) => eventItem.id === item.eventId);
    document.querySelector("#goal-event-title").textContent = `${parentEvent?.title || "イベント未設定"} の長期計画`;
    return;
  }
  const editQuizButton = event.target.closest("[data-edit-quiz]");
  if (editQuizButton) {
    const item = state.quizzes.find((quiz) => quiz.id === editQuizButton.dataset.editQuiz);
    if (!item) return;
    const form = openEditDialog(elements.quizDialog, item, "予定を編集", "変更を保存");
    setScheduleType(form, item.kind === "submission" ? "submission" : "quiz");
    form.elements.title.value = item.title || "";
    form.elements.subject.value = item.subject;
    form.elements.date.value = item.date;
    form.elements.scope.value = item.scope || "";
    form.elements.unit.value = item.unit || "";
    form.elements.period.value = item.period ? String(item.period) : "";
    return;
  }
  const editPoolButton = event.target.closest("[data-edit-pool]");
  if (editPoolButton) {
    const item = state.pools.find((pool) => pool.id === editPoolButton.dataset.editPool);
    if (!item) return;
    const form = openEditDialog(elements.poolDialog, item, "週間プールを編集", "変更を保存");
    form.querySelector('[type="submit"]').disabled = false;
    form.elements.goalId.disabled = true;
    form.elements.goalId.required = false;
    form.elements.target.value = item.target;
    form.elements.start.value = item.start;
    form.elements.end.value = item.end;
    return;
  }
  const editTaskButton = event.target.closest("[data-edit-task]");
  if (editTaskButton) {
    const item = state.tasks.find((task) => task.id === editTaskButton.dataset.editTask);
    if (!item) return;
    const form = openEditDialog(elements.taskDialog, item, "今日の最低ラインを編集", "変更を保存");
    form.elements.poolId.value = item.poolId || "";
    form.elements.minimum.value = item.minimum;
    const pool = state.pools.find((poolItem) => poolItem.id === item.poolId);
    document.querySelector("#task-pool-title").textContent = pool ? `${pool.title}（${pool.unit}）` : item.title;
    return;
  }
  const scheduleTypeButton = event.target.closest("[data-schedule-type]");
  if (scheduleTypeButton) {
    setScheduleType(scheduleTypeButton.closest("form"), scheduleTypeButton.dataset.scheduleType);
    return;
  }
  const addQuizTaskButton = event.target.closest("[data-add-quiz-task]");
  if (addQuizTaskButton) {
    const quiz = state.quizzes.find((item) => item.id === addQuizTaskButton.dataset.addQuizTask);
    if (!quiz || state.tasks.some((task) => task.quizId === quiz.id && task.date === today)) return;
    state.tasks.push({
      id: createId(),
      quizId: quiz.id,
      title: quiz.title || (quiz.kind === "submission" ? "提出物" : "小テスト"),
      subject: quiz.subject,
      scope: quiz.scope || "",
      scopeUnit: quiz.unit || "",
      unit: quiz.kind === "submission" ? (quiz.unit || "件") : "回",
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
    setScheduleType(form, quiz.kind === "submission" ? "submission" : "quiz");
    form.elements.title.value = quiz.title || "";
    form.elements.subject.value = quiz.subject;
    form.elements.date.value = quiz.date;
    form.elements.scope.value = quiz.scope || "";
    form.elements.unit.value = quiz.unit || "";
    form.elements.period.value = quiz.period ? String(quiz.period) : "";
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
  const kind = String(data.get("kind"));
  const title = String(data.get("title")).trim();
  const subject = String(data.get("subject"));
  const date = String(data.get("date"));
  const scope = String(data.get("scope")).trim();
  const unit = String(data.get("unit")).trim();
  const rawPeriod = String(data.get("period") || "");
  const period = rawPeriod ? Number(rawPeriod) : null;
  if (!["quiz", "submission"].includes(kind) || !title || !SUBJECTS.includes(subject) || !date || !scope || (kind === "quiz" && (!Number.isInteger(period) || period < 1 || period > 5)) || (period !== null && (!Number.isInteger(period) || period < 1 || period > 5))) {
    showError(form, "タイトル・範囲・科目・日付・校時を正しく入力してください。小テストは校時が必須です。");
    return;
  }
  const updatedQuiz = { id: form.dataset.editId || createId(), kind, title, subject, date, scope, unit, period };
  if (form.dataset.editId) {
    const index = state.quizzes.findIndex((quiz) => quiz.id === form.dataset.editId);
    if (index < 0) {
      showError(form, "編集する予定が見つかりません。");
      return;
    }
    state.quizzes[index] = updatedQuiz;
    state.tasks.filter((task) => task.quizId === updatedQuiz.id).forEach((task) => {
      task.title = title;
      task.subject = subject;
      task.scope = scope;
      task.scopeUnit = unit;
      task.unit = kind === "submission" ? (unit || "件") : "回";
    });
  } else {
    state.quizzes.push(updatedQuiz);
  }
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
  const updatedEvent = {
    id: form.dataset.editId || createId(),
    title,
    type: String(data.get("type")),
    start,
    end,
  };
  if (form.dataset.editId) {
    const index = state.events.findIndex((item) => item.id === form.dataset.editId);
    if (index < 0) {
      showError(form, "編集するイベントが見つかりません。");
      return;
    }
    state.events[index] = updatedEvent;
  } else {
    state.events.push(updatedEvent);
  }
  if (saveState()) elements.eventDialog.close();
});

document.querySelector("#goal-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const parentEvent = state.events.find((item) => item.id === data.get("eventId"));
  const goal = {
    id: form.dataset.editId || createId(),
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
  if (form.dataset.editId) {
    const index = state.goals.findIndex((item) => item.id === form.dataset.editId);
    if (index < 0) {
      showError(form, "編集する長期目標が見つかりません。");
      return;
    }
    goal.completed = state.goals[index].completed || 0;
    state.goals[index] = goal;
    state.pools.filter((pool) => pool.goalId === goal.id).forEach((pool) => {
      pool.goalTitle = goal.title;
      pool.title = goal.title;
      pool.subject = goal.subject;
      pool.unit = goal.unit;
    });
  } else {
    state.goals.push(goal);
  }
  if (saveState()) elements.goalDialog.close();
});

document.querySelector("#pool-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const editingPool = form.dataset.editId
    ? state.pools.find((item) => item.id === form.dataset.editId)
    : null;
  const goal = state.goals.find((item) => item.id === data.get("goalId"));
  const target = Number(data.get("target"));
  const start = String(data.get("start"));
  const end = String(data.get("end"));
  if (form.dataset.editId && !editingPool) {
    showError(form, "編集する週間プールが見つかりません。");
    return;
  }
  if (!form.dataset.editId && (!goal || goal.completed >= goal.total * goal.laps)) {
    showError(form, "有効な長期目標を選択してください。");
    return;
  }
  if (!Number.isSafeInteger(target) || target < 1 || start > end) {
    showError(form, "目標量と期間を正しく入力してください。");
    return;
  }
  if (editingPool) {
    editingPool.target = target;
    editingPool.start = start;
    editingPool.end = end;
  } else {
    state.pools.push({
      id: createId(), eventId: goal.eventId, goalId: goal.id, goalTitle: goal.title, title: goal.title, subject: goal.subject,
      unit: goal.unit, start, end, target, completed: 0, status: "active",
    });
  }
  if (saveState()) elements.poolDialog.close();
});

document.querySelector("#task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const editingTask = form.dataset.editId
    ? state.tasks.find((item) => item.id === form.dataset.editId)
    : null;
  const pool = state.pools.find((item) => item.id === form.elements.poolId.value);
  const minimum = Number(form.elements.minimum.value);
  if ((form.dataset.editId && !editingTask) || (!form.dataset.editId && (!pool || pool.status !== "active")) || !Number.isSafeInteger(minimum) || minimum < 1) {
    showError(form, "最低量を正しく入力してください。");
    return;
  }
  if (editingTask) {
    editingTask.minimum = minimum;
  } else {
    state.tasks.push({ id: createId(), poolId: pool.id, title: pool.title, subject: pool.subject, unit: pool.unit, minimum, date: today, completed: false });
  }
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

setAuthenticatedView(false);
initializeAuth();
scheduleEventRefresh();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("オフライン機能を有効にできませんでした。", error);
    });
  });
}
