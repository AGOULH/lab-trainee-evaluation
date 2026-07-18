// ═══════════════════════════════════════════════════════════════
//  نظام إدارة وتقييم متدربي المختبر — المنطق الرئيسي
// ═══════════════════════════════════════════════════════════════

import { firebaseConfig, isConfigured } from "./firebase-config.js";
import { parseISO, toISO, addDays, addMonths, isWorkday, generateSchedule, workdaysInMonth } from "./schedule.js";

// تُحمَّل مكتبة Firebase ديناميكيًا حتى لا يتعطل عرض الواجهة إذا تعذر الوصول للـ CDN
let db = null;
let collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, query, where, serverTimestamp;

async function initFirebase() {
  if (db) return;
  const [appM, fsM] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"),
  ]);
  ({ collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, query, where, serverTimestamp } = fsM);
  db = fsM.getFirestore(appM.initializeApp(firebaseConfig));
}

// ─────────────── الثوابت ───────────────

const DEPARTMENTS = [
  { id: "reception",  en: "Reception",  ar: "الاستقبال" },
  { id: "opd",        en: "OPD",        ar: "العيادات الخارجية" },
  { id: "chemistry",  en: "Chemistry",  ar: "الكيمياء" },
  { id: "hematology", en: "Hematology", ar: "أمراض الدم" },
  { id: "viro",       en: "VIRO",       ar: "الفيروسات" },
  { id: "bloodbank",  en: "Blood Bank", ar: "بنك الدم" },
  { id: "micro",      en: "Micro",      ar: "الأحياء الدقيقة" },
];
const deptById = (id) => DEPARTMENTS.find((d) => d.id === id) || { id, en: id, ar: id };

const CRITERIA = [
  { id: "basic_science", en: "Basic Science",                          ar: "العلوم الأساسية" },
  { id: "productivity",  en: "Productivity",                           ar: "الإنتاجية" },
  { id: "quality",       en: "Quality of Work",                        ar: "جودة العمل" },
  { id: "activity",      en: "Scientific Activity and Participation",  ar: "النشاط العلمي والمشاركة" },
  { id: "appearance",    en: "Proper Appearance",                      ar: "المظهر اللائق" },
  { id: "overall",       en: "Overall Evaluation",                     ar: "التقييم العام" },
];

const RATINGS = [
  { id: "FAIR",      en: "FAIR",      ar: "مقبول" },
  { id: "GOOD",      en: "GOOD",      ar: "جيد" },
  { id: "VGOOD",     en: "V.GOOD",    ar: "جيد جدًا" },
  { id: "EXCELLENT", en: "EXCELLENT", ar: "ممتاز" },
];
const ratingById = (id) => RATINGS.find((r) => r.id === id);

const DURATIONS = [
  { months: 2,  label: "شهران" },
  { months: 3,  label: "3 أشهر" },
  { months: 4,  label: "4 أشهر" },
  { months: 6,  label: "6 أشهر" },
  { months: 12, label: "سنة كاملة" },
];

const DAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const MONTH_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

// الحسابات الافتراضية — تُنشأ تلقائيًا في Firestore عند أول تشغيل
const DEFAULT_USERS = [
  { username: "admin", role: "admin", label: "مسؤول التدريب", password: "admin123" },
  ...DEPARTMENTS.map((d) => ({
    username: d.id, role: "dept", dept: d.id,
    label: `قسم ${d.ar}`, password: `${d.id}123`,
  })),
];

// ─────────────── أدوات مساعدة ───────────────

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const todayISO = () => toISO(new Date());

const fmtDate = (iso) => { const d = parseISO(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };
const fmtDateLong = (iso) => { const d = parseISO(iso); return `${DAY_AR[d.getDay()]} ${d.getDate()} ${MONTH_AR[d.getMonth()]} ${d.getFullYear()}`; };

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toast(msg, kind = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<span>${kind === "ok" ? "✅" : "⚠️"}</span><span>${esc(msg)}</span>`;
  $("#toast-stack").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .4s"; setTimeout(() => el.remove(), 400); }, 3400);
}

function openModal(html) {
  $("#modal").innerHTML = html;
  $("#modal-scrim").classList.remove("hidden");
}
function closeModal() { $("#modal-scrim").classList.add("hidden"); $("#modal").innerHTML = ""; }
$("#modal-scrim").addEventListener("click", (e) => { if (e.target.id === "modal-scrim") closeModal(); });

function animateCount(el, target) {
  const dur = 700, t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const traineeEndISO = (t) => t.schedule.length ? t.schedule[t.schedule.length - 1].to : t.startDate;

// ─────────────── Firebase ───────────────

async function seedUsersIfEmpty() {
  const snap = await getDocs(collection(db, "users"));
  if (!snap.empty) return;
  for (const u of DEFAULT_USERS) {
    const { password, ...rest } = u;
    await setDoc(doc(db, "users", u.username), { ...rest, passHash: await sha256(password) });
  }
}

async function fetchTrainees() {
  const snap = await getDocs(collection(db, "trainees"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
}

async function fetchEvaluations(filter = null) {
  let q = collection(db, "evaluations");
  if (filter?.traineeId) q = query(q, where("traineeId", "==", filter.traineeId));
  if (filter?.dept) q = query(q, where("dept", "==", filter.dept));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─────────────── الجلسة ───────────────

const session = {
  get user() { try { return JSON.parse(sessionStorage.getItem("labUser")); } catch { return null; } },
  set user(u) { u ? sessionStorage.setItem("labUser", JSON.stringify(u)) : sessionStorage.removeItem("labUser"); },
};

// ─────────────── التنقل بين الشاشات ───────────────

function show(screen) {
  ["setup-screen", "login-screen", "trainee-portal", "app-shell"].forEach((id) =>
    $("#" + id).classList.toggle("hidden", id !== screen));
}

const NAV = {
  admin: [
    { id: "dashboard",  icon: "📊", label: "لوحة المعلومات" },
    { id: "register",   icon: "➕", label: "تسجيل متدرب" },
    { id: "trainees",   icon: "👥", label: "المتدربون والبحث" },
    { id: "reports",    icon: "📋", label: "التقييمات والتقارير" },
  ],
  dept: [
    { id: "deptTrainees", icon: "👥", label: "متدربو القسم" },
  ],
};

let currentView = null;

function buildShell() {
  const u = session.user;
  const roleLabel = u.role === "admin" ? "مسؤول التدريب" : `قسم ${deptById(u.dept).ar} — ${deptById(u.dept).en}`;
  $("#sidebar-role").textContent = roleLabel;
  $("#topbar-user").textContent = roleLabel;
  const nav = $("#sidebar-nav");
  nav.innerHTML = "";
  NAV[u.role].forEach((item) => {
    const b = document.createElement("button");
    b.className = "nav-item";
    b.dataset.view = item.id;
    b.innerHTML = `<span class="ni">${item.icon}</span>${item.label}`;
    b.addEventListener("click", () => { go(item.id); closeSidebar(); });
    nav.appendChild(b);
  });
  show("app-shell");
  go(NAV[u.role][0].id);
}

function go(view) {
  currentView = view;
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const titles = {
    dashboard: "لوحة المعلومات", register: "تسجيل متدرب جديد",
    trainees: "المتدربون والبحث", reports: "التقييمات والتقرير النهائي",
    deptTrainees: "متدربو القسم",
  };
  $("#topbar-title").textContent = titles[view] || "";
  const c = $("#content");
  c.innerHTML = `<div class="grid stagger"><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:220px"></div></div>`;
  ({ dashboard: renderDashboard, register: renderRegister, trainees: renderTrainees,
     reports: renderReports, deptTrainees: renderDeptTrainees }[view])?.();
}

// القائمة الجانبية على الجوال
const closeSidebar = () => { $("#sidebar").classList.remove("open"); $("#sidebar-scrim").classList.add("hidden"); };
$("#menu-btn").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#sidebar-scrim").classList.remove("hidden"); });
$("#sidebar-scrim").addEventListener("click", closeSidebar);

// الوضع الداكن
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("labTheme", t);
  $("#theme-toggle").textContent = t === "dark" ? "☀️ الوضع الفاتح" : "🌙 الوضع الداكن";
}
$("#theme-toggle").addEventListener("click", () =>
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
applyTheme(localStorage.getItem("labTheme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

$("#logout-btn").addEventListener("click", () => { session.user = null; show("login-screen"); });

// ─────────────── الدخول ───────────────

// قائمة الحسابات: مسؤول التدريب + الأقسام السبعة
$("#login-username").innerHTML =
  `<option value="admin">👤 مسؤول التدريب</option>` +
  DEPARTMENTS.map((d) => `<option value="${d.id}">🧪 قسم ${d.ar} — ${d.en}</option>`).join("");

$$(".tab").forEach((tab) => tab.addEventListener("click", () => {
  $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
  $$(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== tab.dataset.tab));
}));

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#login-btn"), err = $("#login-error");
  err.classList.add("hidden");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span><span class="btn-label">جارٍ الدخول…</span>`;
  try {
    await initFirebase();
    await seedUsersIfEmpty();
    const username = $("#login-username").value.trim().toLowerCase();
    const snap = await getDoc(doc(db, "users", username));
    const hash = await sha256($("#login-password").value);
    if (!snap.exists() || snap.data().passHash !== hash) throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة");
    const u = snap.data();
    session.user = { username: u.username, role: u.role, dept: u.dept || null };
    buildShell();
  } catch (ex) {
    err.textContent = ex.message.includes("غير صحيحة") ? ex.message : "تعذر الاتصال بقاعدة البيانات — تحقق من إعداد Firebase وقواعد Firestore";
    err.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="btn-label">تسجيل الدخول</span>`;
  }
});

// استعلام المتدرب بجدوله عبر رقم الهوية
$("#trainee-lookup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#lookup-error");
  err.classList.add("hidden");
  try {
    await initFirebase();
    const nid = $("#lookup-id").value.trim();
    const snap = await getDocs(query(collection(db, "trainees"), where("nationalId", "==", nid)));
    if (snap.empty) throw new Error("لا يوجد متدرب مسجل بهذا الرقم");
    const t = { id: snap.docs[0].id, ...snap.docs[0].data() };
    $("#portal-content").innerHTML = `
      <div class="card animate-pop">
        <h3 class="card-title">مرحبًا ${esc(t.name)} 👋</h3>
        <p class="card-sub">فترة التدريب: ${fmtDate(t.startDate)} — ${fmtDate(traineeEndISO(t))} (${durationLabel(t.months)})</p>
        ${scheduleTimelineHTML(t)}
      </div>`;
    show("trainee-portal");
  } catch (ex) {
    err.textContent = ex.message.includes("لا يوجد") ? ex.message : "تعذر الاتصال بقاعدة البيانات";
    err.classList.remove("hidden");
  }
});
$("#portal-back").addEventListener("click", () => show("login-screen"));

const durationLabel = (m) => DURATIONS.find((d) => d.months === m)?.label || `${m} شهرًا`;

function scheduleTimelineHTML(t) {
  return `<div class="timeline">` + t.schedule.map((s, i) => `
    <div class="timeline-row">
      <div class="timeline-dot">${i + 1}</div>
      <div class="timeline-dept">${deptById(s.dept).ar} <small>${deptById(s.dept).en}</small></div>
      <div class="timeline-dates">
        ${fmtDate(s.from)} ← ${fmtDate(s.to)}
        <div class="timeline-days">${s.days} يومًا · أحد–خميس صباحًا</div>
      </div>
    </div>`).join("") + `</div>`;
}

// ═══════════════ لوحة المعلومات ═══════════════

let dashPeriod = 3; // بالأشهر — 0 = الكل

async function renderDashboard() {
  const trainees = await fetchTrainees();
  const evals = await fetchEvaluations();
  const today = todayISO();

  const inPeriod = (t) => {
    if (!dashPeriod) return true;
    const from = toISO(addMonths(new Date(), -dashPeriod));
    // كل متدرب تتقاطع فترة تدريبه مع الفترة المحددة
    return traineeEndISO(t) >= from && t.startDate <= today;
  };
  const list = trainees.filter(inPeriod);
  const active = trainees.filter((t) => t.startDate <= today && traineeEndISO(t) >= today);
  const finished = list.filter((t) => traineeEndISO(t) < today);

  // توزيع الأقسام
  const deptCounts = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, 0]));
  list.forEach((t) => t.deptIds.forEach((d) => { if (d in deptCounts) deptCounts[d]++; }));
  const maxDept = Math.max(1, ...Object.values(deptCounts));

  // تسجيلات آخر 6 أشهر
  const monthCols = [];
  for (let i = 5; i >= 0; i--) {
    const d = addMonths(new Date(), -i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthCols.push({ key, label: MONTH_AR[d.getMonth()], count: 0 });
  }
  trainees.forEach((t) => {
    const m = monthCols.find((c) => t.startDate?.startsWith(c.key));
    if (m) m.count++;
  });
  const maxMonth = Math.max(1, ...monthCols.map((c) => c.count));

  const periodBtns = [[1, "شهر"], [2, "شهران"], [3, "3 أشهر"], [6, "6 أشهر"], [0, "الكل"]]
    .map(([v, l]) => `<button data-p="${v}" class="${dashPeriod === v ? "on" : ""}">${l}</button>`).join("");

  $("#content").innerHTML = `
    <div class="view">
      <div class="card-head" style="margin-bottom:16px">
        <div>
          <h3 class="card-title">نظرة عامة</h3>
          <p class="card-sub" style="margin:0">المتدربون الذين تتقاطع فترتهم مع ${dashPeriod ? `آخر ${durationLabel(dashPeriod)}` : "كامل السجل"}</p>
        </div>
        <div class="seg" id="dash-period">${periodBtns}</div>
      </div>

      <div class="grid grid-stats stagger">
        <div class="card stat-tile"><div class="stat-icon">👥</div>
          <div class="stat-label">متدربو الفترة</div>
          <div class="stat-value" data-count="${list.length}">0</div>
          <div class="stat-foot">إجمالي السجل: ${trainees.length}</div></div>
        <div class="card stat-tile"><div class="stat-icon">🟢</div>
          <div class="stat-label">على رأس التدريب الآن</div>
          <div class="stat-value" data-count="${active.length}">0</div>
          <div class="stat-foot">حتى ${fmtDate(today)}</div></div>
        <div class="card stat-tile"><div class="stat-icon">🎓</div>
          <div class="stat-label">أكملوا التدريب</div>
          <div class="stat-value" data-count="${finished.length}">0</div>
          <div class="stat-foot">ضمن الفترة المحددة</div></div>
        <div class="card stat-tile"><div class="stat-icon">📝</div>
          <div class="stat-label">تقييمات مسجلة</div>
          <div class="stat-value" data-count="${evals.length}">0</div>
          <div class="stat-foot">من جميع الأقسام</div></div>
      </div>

      <div class="grid grid-2" style="margin-top:18px">
        <div class="card">
          <h3 class="card-title">توزيع المتدربين على الأقسام</h3>
          <p class="card-sub">عدد متدربي الفترة المجدولين في كل قسم</p>
          <div class="hbar-list">
            ${DEPARTMENTS.map((d) => `
              <div class="hbar" title="${d.ar}: ${deptCounts[d.id]} متدرب">
                <div class="hbar-name">${d.ar}<small>${d.en}</small></div>
                <div class="hbar-track"><div class="hbar-fill ${deptCounts[d.id] ? "" : "zero"}" style="width:${(deptCounts[d.id] / maxDept) * 100}%"></div></div>
                <div class="hbar-val">${deptCounts[d.id]}</div>
              </div>`).join("")}
          </div>
        </div>
        <div class="card">
          <h3 class="card-title">تسجيلات جديدة شهريًا</h3>
          <p class="card-sub">عدد المتدربين الجدد في آخر 6 أشهر</p>
          <div class="vbar-wrap">
            ${monthCols.map((c) => `
              <div class="vbar-col" title="${c.label}: ${c.count}">
                <div class="vbar-num">${c.count}</div>
                <div class="vbar" style="height:${(c.count / maxMonth) * 100}%"></div>
              </div>`).join("")}
          </div>
          <div class="vbar-labels">${monthCols.map((c) => `<span>${c.label}</span>`).join("")}</div>
        </div>
      </div>
    </div>`;

  $$("#dash-period button").forEach((b) => b.addEventListener("click", () => {
    dashPeriod = Number(b.dataset.p);
    renderDashboard();
  }));
  $$(".stat-value").forEach((el) => animateCount(el, Number(el.dataset.count)));
}

// ═══════════════ تسجيل متدرب ═══════════════

function renderRegister() {
  $("#content").innerHTML = `
    <div class="view card" style="max-width:760px">
      <h3 class="card-title">بيانات المتدرب</h3>
      <p class="card-sub">يُنشأ الجدول التدريبي تلقائيًا بتوزيع المدة بالتساوي على الأقسام المختارة</p>
      <form id="reg-form">
        <div class="field-row">
          <label class="field"><span>اسم المتدرب</span>
            <input id="reg-name" required placeholder="الاسم الكامل" /></label>
          <label class="field"><span>رقم الهوية</span>
            <input id="reg-nid" required inputmode="numeric" dir="ltr" placeholder="1234567890" /></label>
        </div>
        <div class="field-row">
          <label class="field"><span>تاريخ بداية التدريب</span>
            <input id="reg-start" type="date" required value="${todayISO()}" /></label>
          <label class="field"><span>مدة التدريب</span>
            <select id="reg-months">
              ${DURATIONS.map((d) => `<option value="${d.months}" ${d.months === 6 ? "selected" : ""}>${d.label}</option>`).join("")}
              <option value="custom">مدة أخرى…</option>
            </select></label>
        </div>
        <label class="field hidden" id="custom-months-wrap"><span>عدد الأشهر</span>
          <input id="reg-custom-months" type="number" min="1" max="24" value="1" /></label>

        <div class="field">
          <span>الأقسام</span>
          <div class="dept-picker" id="reg-depts">
            <button type="button" class="dept-chip all on" data-all>✔ كل الأقسام</button>
            ${DEPARTMENTS.map((d) => `<button type="button" class="dept-chip on" data-dept="${d.id}">${d.ar} · ${d.en}</button>`).join("")}
          </div>
          <p class="form-hint">اختر «كل الأقسام» أو انقر الأقسام المطلوبة فقط — الترتيب حسب تسلسل الأقسام</p>
        </div>

        <div class="card" style="background:var(--surface-2); box-shadow:none" id="schedule-preview"></div>

        <div class="modal-foot" style="justify-content:flex-start">
          <button type="submit" class="btn btn-primary" id="reg-submit">💾 حفظ وتوليد الجدول</button>
        </div>
      </form>
    </div>`;

  const preview = () => {
    const months = regMonths();
    const depts = regDepts();
    const start = $("#reg-start").value;
    const box = $("#schedule-preview");
    if (!start || !depts.length) { box.innerHTML = `<p class="muted" style="margin:0">اختر التاريخ والأقسام لعرض معاينة الجدول</p>`; return; }
    const sched = generateSchedule(start, months, depts);
    box.innerHTML = `<h4 style="margin:0 0 10px;font-size:14px">معاينة الجدول التدريبي</h4>` +
      scheduleTimelineHTML({ schedule: sched });
  };
  const regMonths = () => $("#reg-months").value === "custom" ? Math.max(1, Number($("#reg-custom-months").value) || 1) : Number($("#reg-months").value);
  const regDepts = () => $$("#reg-depts .dept-chip[data-dept].on").map((c) => c.dataset.dept);

  $("#reg-months").addEventListener("change", () => {
    $("#custom-months-wrap").classList.toggle("hidden", $("#reg-months").value !== "custom");
    preview();
  });
  $("#reg-custom-months").addEventListener("input", preview);
  $("#reg-start").addEventListener("change", preview);

  const allChip = $("#reg-depts [data-all]");
  const syncAllChip = () => allChip.classList.toggle("on", regDepts().length === DEPARTMENTS.length);
  allChip.addEventListener("click", () => {
    const turnOn = !allChip.classList.contains("on");
    $$("#reg-depts .dept-chip[data-dept]").forEach((c) => c.classList.toggle("on", turnOn));
    syncAllChip(); preview();
  });
  $$("#reg-depts .dept-chip[data-dept]").forEach((c) => c.addEventListener("click", () => {
    c.classList.toggle("on"); syncAllChip(); preview();
  }));
  preview();

  $("#reg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const depts = regDepts();
    if (!depts.length) { toast("اختر قسمًا واحدًا على الأقل", "err"); return; }
    const btn = $("#reg-submit");
    btn.disabled = true;
    try {
      const nid = $("#reg-nid").value.trim();
      const dup = await getDocs(query(collection(db, "trainees"), where("nationalId", "==", nid)));
      if (!dup.empty) throw new Error("يوجد متدرب مسجل بنفس رقم الهوية");
      const months = regMonths();
      const startDate = $("#reg-start").value;
      await addDoc(collection(db, "trainees"), {
        name: $("#reg-name").value.trim(),
        nationalId: nid,
        startDate, months,
        deptIds: depts,
        schedule: generateSchedule(startDate, months, depts),
        createdAt: serverTimestamp(),
      });
      toast("تم تسجيل المتدرب وتوليد جدوله بنجاح");
      go("trainees");
    } catch (ex) {
      toast(ex.message.includes("نفس رقم") ? ex.message : "تعذر الحفظ — تحقق من الاتصال", "err");
      btn.disabled = false;
    }
  });
}

// ═══════════════ المتدربون والبحث ═══════════════

async function renderTrainees() {
  const trainees = await fetchTrainees();

  $("#content").innerHTML = `
    <div class="view card">
      <div class="card-head">
        <div><h3 class="card-title">سجل المتدربين</h3>
          <p class="card-sub" style="margin:0">البحث بالاسم أو رقم الهوية أو فترة التدريب</p></div>
        <button class="btn btn-primary btn-sm" id="go-register">➕ متدرب جديد</button>
      </div>
      <div class="search-bar">
        <label class="field"><input id="q-text" placeholder="🔍 بحث بالاسم أو رقم الهوية…" /></label>
        <label class="field" style="flex:0 0 auto"><input id="q-from" type="date" title="تدريب يتقاطع مع الفترة من" /></label>
        <label class="field" style="flex:0 0 auto"><input id="q-to" type="date" title="إلى" /></label>
        <button class="btn btn-ghost btn-sm" id="q-clear">مسح</button>
      </div>
      <div id="trainee-table"></div>
    </div>`;

  $("#go-register").addEventListener("click", () => go("register"));

  const draw = () => {
    const txt = $("#q-text").value.trim().toLowerCase();
    const from = $("#q-from").value, to = $("#q-to").value;
    const list = trainees.filter((t) => {
      const matchTxt = !txt || t.name.toLowerCase().includes(txt) || t.nationalId.includes(txt);
      const end = traineeEndISO(t);
      const matchFrom = !from || end >= from;
      const matchTo = !to || t.startDate <= to;
      return matchTxt && matchFrom && matchTo;
    });
    const today = todayISO();
    $("#trainee-table").innerHTML = !list.length
      ? `<div class="empty-state"><div class="big">🔍</div>لا توجد نتائج مطابقة</div>`
      : `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>المتدرب</th><th>رقم الهوية</th><th>الفترة</th><th>المدة</th><th>الأقسام</th><th>الحالة</th><th></th></tr></thead>
          <tbody>${list.map((t) => {
            const end = traineeEndISO(t);
            const status = t.startDate > today ? `<span class="badge badge-amber">لم يبدأ</span>`
              : end < today ? `<span class="badge badge-gray">مكتمل</span>`
              : `<span class="badge badge-green">● جارٍ</span>`;
            return `<tr>
              <td><b>${esc(t.name)}</b></td>
              <td class="num">${esc(t.nationalId)}</td>
              <td class="num">${fmtDate(t.startDate)} — ${fmtDate(end)}</td>
              <td>${durationLabel(t.months)}</td>
              <td><span class="badge badge-blue">${t.deptIds.length === DEPARTMENTS.length ? "كل الأقسام" : `${t.deptIds.length} أقسام`}</span></td>
              <td>${status}</td>
              <td><div class="row-actions">
                <button class="btn btn-outline btn-sm" data-act="view" data-id="${t.id}">👁 التفاصيل</button>
                <button class="btn btn-outline btn-sm" data-act="sheet" data-id="${t.id}">🖨 Time Sheet</button>
                <button class="btn btn-ghost btn-sm danger" data-act="del" data-id="${t.id}">🗑</button>
              </div></td></tr>`;
          }).join("")}</tbody></table></div>`;

    $$("#trainee-table [data-act]").forEach((b) => b.addEventListener("click", () => {
      const t = trainees.find((x) => x.id === b.dataset.id);
      if (b.dataset.act === "view") openTraineeModal(t);
      if (b.dataset.act === "sheet") printTimesheet(t);
      if (b.dataset.act === "del") confirmDelete(t);
    }));
  };

  ["q-text", "q-from", "q-to"].forEach((id) => $("#" + id).addEventListener("input", draw));
  $("#q-clear").addEventListener("click", () => { $("#q-text").value = $("#q-from").value = $("#q-to").value = ""; draw(); });
  draw();
}

function confirmDelete(t) {
  openModal(`
    <div class="modal-head"><h3>حذف المتدرب</h3></div>
    <p>سيتم حذف <b>${esc(t.name)}</b> وجميع تقييماته نهائيًا. هل أنت متأكد؟</p>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="del-cancel">إلغاء</button>
      <button class="btn btn-primary" style="background:var(--danger);box-shadow:none" id="del-ok">نعم، احذف</button>
    </div>`);
  $("#del-cancel").addEventListener("click", closeModal);
  $("#del-ok").addEventListener("click", async () => {
    try {
      const evals = await fetchEvaluations({ traineeId: t.id });
      await Promise.all(evals.map((ev) => deleteDoc(doc(db, "evaluations", ev.id))));
      await deleteDoc(doc(db, "trainees", t.id));
      closeModal(); toast("تم حذف المتدرب");
      go(currentView);
    } catch { toast("تعذر الحذف", "err"); }
  });
}

async function openTraineeModal(t) {
  const evals = await fetchEvaluations({ traineeId: t.id });
  const evaluatedDepts = new Set(evals.map((e) => e.dept));
  openModal(`
    <div class="modal-head"><h3>👤 ${esc(t.name)}</h3>
      <button class="icon-btn" id="tm-close">✕</button></div>
    <p class="card-sub">
      رقم الهوية: <b class="num">${esc(t.nationalId)}</b> ·
      المدة: <b>${durationLabel(t.months)}</b> ·
      من ${fmtDateLong(t.startDate)} إلى ${fmtDateLong(traineeEndISO(t))}
    </p>
    <h4 style="margin:16px 0 10px">الجدول التدريبي <span class="muted" style="font-weight:400;font-size:12px">(أحد–خميس، فترة صباحية)</span></h4>
    ${scheduleTimelineHTML(t)}
    <h4 style="margin:18px 0 10px">حالة التقييم</h4>
    <div class="dept-picker">
      ${t.deptIds.map((d) => `<span class="badge ${evaluatedDepts.has(d) ? "badge-green" : "badge-gray"}">${deptById(d).ar} ${evaluatedDepts.has(d) ? "✓" : "—"}</span>`).join("")}
    </div>
    <div class="modal-foot">
      <button class="btn btn-outline" id="tm-sheet">🖨 طباعة Time Sheet</button>
      <button class="btn btn-primary" id="tm-report" ${evals.length ? "" : "disabled"}>📄 التقرير النهائي</button>
    </div>`);
  $("#tm-close").addEventListener("click", closeModal);
  $("#tm-sheet").addEventListener("click", () => printTimesheet(t));
  $("#tm-report").addEventListener("click", () => printFinalReport(t, evals));
}

// ═══════════════ التقييمات والتقارير (مسؤول التدريب) ═══════════════

async function renderReports() {
  const [trainees, evals] = await Promise.all([fetchTrainees(), fetchEvaluations()]);
  const byTrainee = {};
  evals.forEach((e) => { (byTrainee[e.traineeId] ||= []).push(e); });

  $("#content").innerHTML = `
    <div class="view card">
      <div class="card-head">
        <div><h3 class="card-title">تقييمات الأقسام مجمعة</h3>
          <p class="card-sub" style="margin:0">ابحث باسم المتدرب أو صفِّ حسب القسم، ثم صدّر التقرير النهائي</p></div>
      </div>
      <div class="search-bar">
        <label class="field"><input id="r-text" placeholder="🔍 بحث باسم المتدرب…" /></label>
        <label class="field" style="flex:0 0 auto">
          <select id="r-dept">
            <option value="">كل الأقسام</option>
            ${DEPARTMENTS.map((d) => `<option value="${d.id}">${d.ar} · ${d.en}</option>`).join("")}
          </select></label>
      </div>
      <div id="report-table"></div>
    </div>`;

  const draw = () => {
    const txt = $("#r-text").value.trim().toLowerCase();
    const dept = $("#r-dept").value;
    const list = trainees.filter((t) => {
      const tEvals = byTrainee[t.id] || [];
      const matchTxt = !txt || t.name.toLowerCase().includes(txt);
      const matchDept = !dept || tEvals.some((e) => e.dept === dept);
      return matchTxt && matchDept;
    });
    $("#report-table").innerHTML = !list.length
      ? `<div class="empty-state"><div class="big">📋</div>لا توجد نتائج</div>`
      : `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>المتدرب</th><th>الأقسام المُقيِّمة</th><th>التقدم</th><th></th></tr></thead>
          <tbody>${list.map((t) => {
            const tEvals = byTrainee[t.id] || [];
            const done = tEvals.length, total = t.deptIds.length;
            return `<tr>
              <td><b>${esc(t.name)}</b><br><small class="muted num">${esc(t.nationalId)}</small></td>
              <td><div class="dept-picker">${t.deptIds.map((d) => {
                const has = tEvals.some((e) => e.dept === d);
                return `<span class="badge ${has ? "badge-green" : "badge-gray"}">${deptById(d).en}</span>`;
              }).join("")}</div></td>
              <td><span class="badge ${done === total ? "badge-green" : done ? "badge-amber" : "badge-gray"}">${done} / ${total}</span></td>
              <td><div class="row-actions">
                <button class="btn btn-outline btn-sm" data-view="${t.id}">عرض التقييمات</button>
                <button class="btn btn-primary btn-sm" data-print="${t.id}" ${done ? "" : "disabled"}>📄 تصدير التقرير</button>
              </div></td></tr>`;
          }).join("")}</tbody></table></div>`;

    $$("#report-table [data-view]").forEach((b) => b.addEventListener("click", () =>
      openEvaluationsModal(trainees.find((t) => t.id === b.dataset.view), byTrainee[b.dataset.view] || [])));
    $$("#report-table [data-print]").forEach((b) => b.addEventListener("click", () =>
      printFinalReport(trainees.find((t) => t.id === b.dataset.print), byTrainee[b.dataset.print] || [])));
  };
  $("#r-text").addEventListener("input", draw);
  $("#r-dept").addEventListener("change", draw);
  draw();
}

function evalMatrixHTML(t, evals) {
  const cols = t.deptIds;
  return `<div class="table-wrap"><table class="tbl" style="min-width:640px">
    <thead><tr><th>المعيار</th>${cols.map((d) => `<th style="text-align:center">${deptById(d).en}</th>`).join("")}</tr></thead>
    <tbody>
      ${CRITERIA.map((c) => `<tr>
        <td><b>${c.ar}</b><br><small class="muted">${c.en}</small></td>
        ${cols.map((d) => {
          const ev = evals.find((e) => e.dept === d);
          const r = ev?.scores?.[c.id] ? ratingById(ev.scores[c.id]) : null;
          return `<td style="text-align:center">${r ? `<span class="badge badge-blue">${r.en}</span>` : `<span class="muted">—</span>`}</td>`;
        }).join("")}
      </tr>`).join("")}
    </tbody></table></div>`;
}

function openEvaluationsModal(t, evals) {
  openModal(`
    <div class="modal-head"><h3>📋 تقييمات ${esc(t.name)}</h3>
      <button class="icon-btn" id="em-close">✕</button></div>
    ${evals.length ? evalMatrixHTML(t, evals) : `<div class="empty-state"><div class="big">📝</div>لم يسجَّل أي تقييم بعد</div>`}
    <div class="modal-foot">
      <button class="btn btn-primary" id="em-print" ${evals.length ? "" : "disabled"}>📄 تصدير التقرير النهائي</button>
    </div>`);
  $("#em-close").addEventListener("click", closeModal);
  $("#em-print").addEventListener("click", () => printFinalReport(t, evals));
}

// ═══════════════ واجهة القسم ═══════════════

async function renderDeptTrainees() {
  const me = session.user;
  const d = deptById(me.dept);
  const trainees = (await fetchTrainees()).filter((t) => t.deptIds.includes(me.dept));
  const evals = await fetchEvaluations({ dept: me.dept });
  const today = todayISO();

  $("#content").innerHTML = `
    <div class="view card">
      <div class="card-head">
        <div><h3 class="card-title">متدربو قسم ${d.ar} <span class="muted" style="font-size:13px">${d.en}</span></h3>
          <p class="card-sub" style="margin:0">قيّم كل متدرب مرّ على القسم — يمكن تعديل التقييم لاحقًا</p></div>
      </div>
      <div class="search-bar">
        <label class="field"><input id="d-text" placeholder="🔍 بحث بالاسم أو رقم الهوية…" /></label>
      </div>
      <div id="dept-table"></div>
    </div>`;

  const draw = () => {
    const txt = $("#d-text").value.trim().toLowerCase();
    const list = trainees.filter((t) => !txt || t.name.toLowerCase().includes(txt) || t.nationalId.includes(txt));
    $("#dept-table").innerHTML = !list.length
      ? `<div class="empty-state"><div class="big">👥</div>لا يوجد متدربون مجدولون في هذا القسم</div>`
      : `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>المتدرب</th><th>رقم الهوية</th><th>فترته في القسم</th><th>الحالة</th><th>التقييم</th><th></th></tr></thead>
          <tbody>${list.map((t) => {
            const seg = t.schedule.find((s) => s.dept === me.dept);
            const ev = evals.find((e) => e.traineeId === t.id);
            const inDept = seg && seg.from <= today && seg.to >= today;
            const status = !seg ? "" : inDept ? `<span class="badge badge-green">● في القسم الآن</span>`
              : seg.to < today ? `<span class="badge badge-gray">انتهى</span>` : `<span class="badge badge-amber">قادم</span>`;
            return `<tr>
              <td><b>${esc(t.name)}</b></td>
              <td class="num">${esc(t.nationalId)}</td>
              <td class="num">${seg ? `${fmtDate(seg.from)} — ${fmtDate(seg.to)}` : "—"}</td>
              <td>${status}</td>
              <td>${ev ? `<span class="badge badge-green">مُقيَّم ✓</span>` : `<span class="badge badge-red">بانتظار التقييم</span>`}</td>
              <td><button class="btn ${ev ? "btn-outline" : "btn-primary"} btn-sm" data-ev="${t.id}">${ev ? "✏️ تعديل التقييم" : "📝 تقييم"}</button></td>
            </tr>`;
          }).join("")}</tbody></table></div>`;

    $$("#dept-table [data-ev]").forEach((b) => b.addEventListener("click", () => {
      const t = trainees.find((x) => x.id === b.dataset.ev);
      openEvaluationForm(t, evals.find((e) => e.traineeId === t.id));
    }));
  };
  $("#d-text").addEventListener("input", draw);
  draw();
}

function openEvaluationForm(t, existing) {
  const me = session.user;
  const d = deptById(me.dept);
  openModal(`
    <div class="modal-head"><h3>📝 تقييم: ${esc(t.name)}</h3>
      <button class="icon-btn" id="ev-close">✕</button></div>
    <p class="card-sub">قسم ${d.ar} — ${d.en} · اختر درجة لكل معيار</p>
    <div class="rate-grid">
      ${CRITERIA.map((c) => `
        <div class="rate-row" data-crit="${c.id}">
          <div class="rate-crit">${c.ar}<small>${c.en}</small></div>
          <div class="rate-opts">
            ${RATINGS.map((r) => `<button type="button" class="rate-opt ${existing?.scores?.[c.id] === r.id ? "on" : ""}" data-r="${r.id}">${r.en}</button>`).join("")}
          </div>
        </div>`).join("")}
    </div>
    <label class="field" style="margin-top:14px"><span>اسم المُقيِّم (اختياري)</span>
      <input id="ev-name" value="${esc(existing?.evaluatorName || "")}" placeholder="اسم رئيس القسم أو المشرف" /></label>
    <label class="field"><span>ملاحظات (اختياري)</span>
      <textarea id="ev-notes" rows="2" placeholder="ملاحظات إضافية…">${esc(existing?.notes || "")}</textarea></label>
    <p id="ev-error" class="form-error hidden"></p>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="ev-cancel">إلغاء</button>
      <button class="btn btn-primary" id="ev-save">💾 حفظ التقييم</button>
    </div>`);

  $$(".rate-row").forEach((row) =>
    $$(".rate-opt", row).forEach((opt) => opt.addEventListener("click", () => {
      $$(".rate-opt", row).forEach((o) => o.classList.toggle("on", o === opt));
    })));
  $("#ev-close").addEventListener("click", closeModal);
  $("#ev-cancel").addEventListener("click", closeModal);
  $("#ev-save").addEventListener("click", async () => {
    const scores = {};
    let missing = false;
    $$(".rate-row").forEach((row) => {
      const sel = $(".rate-opt.on", row);
      if (!sel) missing = true;
      else scores[row.dataset.crit] = sel.dataset.r;
    });
    if (missing) {
      $("#ev-error").textContent = "الرجاء اختيار درجة لكل المعايير";
      $("#ev-error").classList.remove("hidden");
      return;
    }
    try {
      await setDoc(doc(db, "evaluations", `${t.id}_${me.dept}`), {
        traineeId: t.id, dept: me.dept, scores,
        evaluatorName: $("#ev-name").value.trim(),
        notes: $("#ev-notes").value.trim(),
        updatedAt: serverTimestamp(),
      });
      closeModal(); toast("تم حفظ التقييم بنجاح");
      go("deptTrainees");
    } catch { toast("تعذر حفظ التقييم", "err"); }
  });
}

// ═══════════════ الطباعة: Time Sheet ═══════════════
// كل شهر في ورقة مستقلة — أيام الأحد إلى الخميس فقط

function printTimesheet(t) {
  const start = parseISO(t.startDate);
  const end = parseISO(traineeEndISO(t));
  const sheets = [];
  let m = new Date(start.getFullYear(), start.getMonth(), 1);

  while (m <= end) {
    const rows = workdaysInMonth(m, start, end);
    if (rows.length) {
      sheets.push(`
        <div class="sheet">
          <div class="sheet-header">
            <h1>سجل الحضور والانصراف — Time Sheet</h1>
            <h2>قسم المختبر — الفترة الصباحية (الأحد – الخميس)</h2>
          </div>
          <div class="sheet-meta">
            <span>الاسم: ${esc(t.name)}</span>
            <span>رقم الهوية: ${esc(t.nationalId)}</span>
            <span>الشهر: ${MONTH_AR[m.getMonth()]} ${m.getFullYear()}</span>
          </div>
          <table class="print-tbl">
            <thead><tr>
              <th style="width:16%">التاريخ</th><th style="width:12%">اليوم</th>
              <th style="width:16%">وقت الحضور</th><th style="width:20%">توقيع الحضور</th>
              <th style="width:16%">وقت الانصراف</th><th style="width:20%">توقيع الانصراف</th>
            </tr></thead>
            <tbody>
              ${rows.map((d) => `<tr>
                <td>${fmtDate(toISO(d))}</td><td>${DAY_AR[d.getDay()]}</td>
                <td class="sig-cell"></td><td class="sig-cell"></td>
                <td class="sig-cell"></td><td class="sig-cell"></td>
              </tr>`).join("")}
            </tbody>
          </table>
          <div class="print-foot">
            <div class="sig-line">توقيع مسؤول التدريب</div>
            <div class="sig-line">ختم القسم</div>
          </div>
        </div>`);
    }
    m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
  }

  $("#print-root").innerHTML = sheets.join("");
  window.print();
}

// ═══════════════ الطباعة: التقرير النهائي ═══════════════

function printFinalReport(t, evals) {
  const cols = t.deptIds;
  $("#print-root").innerHTML = `
    <div class="sheet">
      <div class="sheet-header">
        <h1>التقرير النهائي لتقييم المتدرب</h1>
        <h2>Laboratory Trainee — Final Evaluation Report</h2>
      </div>
      <div class="sheet-meta">
        <span>الاسم: ${esc(t.name)}</span>
        <span>رقم الهوية: ${esc(t.nationalId)}</span>
        <span>المدة: ${durationLabel(t.months)}</span>
        <span>الفترة: ${fmtDate(t.startDate)} — ${fmtDate(traineeEndISO(t))}</span>
      </div>
      <table class="print-tbl">
        <thead><tr>
          <th style="text-align:right">المعيار — Criteria</th>
          ${cols.map((d) => `<th>${deptById(d).en}</th>`).join("")}
        </tr></thead>
        <tbody>
          ${CRITERIA.map((c) => `<tr>
            <td style="text-align:right"><b>${c.en}</b><br>${c.ar}</td>
            ${cols.map((d) => {
              const ev = evals.find((e) => e.dept === d);
              const r = ev?.scores?.[c.id] ? ratingById(ev.scores[c.id]).en : "—";
              return `<td class="report-badge">${r}</td>`;
            }).join("")}
          </tr>`).join("")}
        </tbody>
      </table>
      ${evals.some((e) => e.notes) ? `
        <h3 style="font-size:13px;margin:14px 0 6px">ملاحظات الأقسام</h3>
        ${evals.filter((e) => e.notes).map((e) => `<p style="font-size:11.5px;margin:3px 0"><b>${deptById(e.dept).en}:</b> ${esc(e.notes)}</p>`).join("")}` : ""}
      <div class="print-foot">
        <div class="sig-line">مسؤول التدريب</div>
        <div class="sig-line">التاريخ: ${fmtDate(todayISO())}</div>
      </div>
    </div>`;
  window.print();
}

// ═══════════════ الإقلاع ═══════════════

(async () => {
  if (!isConfigured) { show("setup-screen"); return; }
  try { await initFirebase(); } catch {
    toast("تعذر تحميل مكتبة Firebase — تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة", "err");
  }
  if (db && session.user) buildShell();
  else show("login-screen");
})();
