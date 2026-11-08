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

// درجة رقمية لكل تقدير (1–4) لحساب المعدل فقط — البيانات المحفوظة تبقى بالتقديرات نفسها
const RATING_SCORE = { FAIR: 1, GOOD: 2, VGOOD: 3, EXCELLENT: 4 };
const MAX_SCORE = RATINGS.length;
// معدل تقييم واحد (متوسط درجات معاييره) أو null
const evalAvg = (ev) => {
  const v = Object.values(ev?.scores || {}).map((r) => RATING_SCORE[r]).filter(Boolean);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
// متوسط مجموعة تقييمات
const avgOf = (evals) => {
  const v = evals.map(evalAvg).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
// أقرب تقدير لمعدل رقمي
const ratingForAvg = (a) => a == null ? null : RATINGS[Math.min(MAX_SCORE, Math.max(1, Math.round(a))) - 1];
const fmtAvg = (a) => a == null ? "—" : a.toFixed(1);

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
    label: `قسم ${d.ar}`, password: "1234",
  })),
];

// ─────────────── الأيقونات (SVG بنمط Lucide) ───────────────
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  pen: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m10.5 17.5 5-5-2-2-5 5V17.5z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  graduation: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  flask: '<path d="M9 3h6"/><path d="M10 3v6.5L4.5 19A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2L14 9.5V3"/><path d="M7 15h10"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  lightbulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
  chevron: '<polyline points="6 9 12 15 18 9"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
};
const ic = (name, size = 18) =>
  `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;

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
  el.innerHTML = `${ic(kind === "ok" ? "checkCircle" : "alert", 20)}<span>${esc(msg)}</span>`;
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
    { id: "dashboard", icon: "dashboard",  label: "لوحة المعلومات" },
    { id: "trainees",  icon: "users",      label: "المتدربون" },
    { id: "register",  icon: "userPlus",   label: "تسجيل متدرب" },
    { id: "reports",   icon: "clipboard",  label: "التقارير" },
    { id: "criteria",  icon: "listChecks", label: "معايير التقييم" },
    { id: "guide",     icon: "book",       label: "دليل المستخدم" },
  ],
  dept: [
    { id: "dashboard",    icon: "dashboard",  label: "لوحة المعلومات" },
    { id: "deptTrainees", icon: "users",      label: "المتدربون" },
    { id: "newEval",      icon: "pen",        label: "تقييم جديد" },
    { id: "criteria",     icon: "listChecks", label: "معايير التقييم" },
    { id: "guide",        icon: "book",       label: "دليل المستخدم" },
  ],
};

// زر الترويسة الرئيسي: القسم يبدأ تقييمًا جديدًا، والمسؤول يسجّل متدربًا
const HEADER_ACTION = {
  admin: { view: "register", icon: "userPlus", label: "متدرب جديد" },
  dept:  { view: "newEval",  icon: "pen",      label: "تقييم جديد" },
};

// البحث في الترويسة: كل شاشة فيها جدول تسجّل دالة تصفية
let searchHandler = null;
const searchQ = () => ($("#top-search")?.value || "").trim().toLowerCase();

let currentView = null;

function buildShell() {
  const u = session.user;
  const roleLabel = u.role === "admin" ? "مسؤول التدريب" : `قسم ${deptById(u.dept).ar} — ${deptById(u.dept).en}`;
  $("#sidebar-role").textContent = roleLabel;
  $("#topbar-user").innerHTML = `<span class="avatar">${ic("user", 15)}</span><span class="who">${esc(roleLabel)}</span>`;
  $("#topbar-user").title = roleLabel;
  const nav = $("#sidebar-nav");
  nav.innerHTML = "";
  NAV[u.role].forEach((item) => {
    const b = document.createElement("button");
    b.className = "nav-item";
    b.dataset.view = item.id;
    b.innerHTML = `<span class="ni">${ic(item.icon, 19)}</span><span>${item.label}</span>`;
    b.addEventListener("click", () => { go(item.id); closeSidebar(); });
    nav.appendChild(b);
  });
  const act = HEADER_ACTION[u.role];
  $("#header-action").innerHTML = `${ic(act.icon, 18)}<span>${act.label}</span>`;
  $("#header-action").onclick = () => go(act.view);
  show("app-shell");
  go(NAV[u.role][0].id);
}

function go(view, { keepSearch = false } = {}) {
  currentView = view;
  searchHandler = null;
  if (!keepSearch) $("#top-search").value = "";
  $$(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
    if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  const titles = {
    dashboard: "لوحة المعلومات", register: "تسجيل متدرب جديد",
    trainees: "المتدربون", reports: "التقييمات والتقرير النهائي",
    deptTrainees: "متدربو القسم", newEval: "تقييم جديد",
    criteria: "معايير التقييم", guide: "دليل المستخدم",
  };
  $("#topbar-title").textContent = titles[view] || "";
  const c = $("#content");
  c.innerHTML = `<div class="grid stagger"><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:220px"></div></div>`;
  c.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
  ({ dashboard: renderDashboard, newEval: () => renderDashboard({ focusForm: true }),
     register: renderRegister, trainees: renderTrainees, reports: renderReports,
     deptTrainees: renderDeptTrainees, criteria: renderCriteria, guide: renderGuide }[view])?.();
}

// على الجوال تتحول القائمة الجانبية لشريط أفقي ثابت، فلا حاجة لفتحها وإغلاقها
const closeSidebar = () => {};

// البحث من الترويسة: يصفّي جدول الشاشة الحالية، أو ينقل لقائمة المتدربين إذا ما فيها جدول
$("#top-search").addEventListener("input", () => {
  if (searchHandler) return searchHandler();
  const role = session.user?.role;
  if (role) go(role === "admin" ? "trainees" : "deptTrainees", { keepSearch: true });
});


$("#logout-btn").addEventListener("click", () => { session.user = null; show("login-screen"); });

// ─────────────── تغيير كلمة المرور ───────────────
// كل حساب يغيّر كلمته بعد إدخال الكلمة الحالية؛ المسؤول يقدر يعيد تعيين كلمات الأقسام بدونها.
$("#change-pass-btn").addEventListener("click", () => {
  closeSidebar();
  const me = session.user;
  const isAdmin = me.role === "admin";
  const accounts = isAdmin ? DEFAULT_USERS.map((u) => ({ id: u.username, label: u.label })) : [];
  openModal(`
    <div class="modal-head"><h3>${ic("key", 20)} تغيير كلمة المرور</h3>
      <button class="icon-btn" id="cp-close" aria-label="إغلاق">${ic("close")}</button></div>
    <form id="cp-form">
      ${isAdmin ? `
      <label class="field"><span>الحساب</span>
        <select id="cp-user">${accounts.map((a) =>
          `<option value="${esc(a.id)}"${a.id === me.username ? " selected" : ""}>${esc(a.label)}</option>`).join("")}</select>
      </label>` : ""}
      <label class="field" id="cp-current-wrap"><span>كلمة المرور الحالية</span>
        <input type="password" id="cp-current" autocomplete="current-password" dir="ltr" /></label>
      <label class="field"><span>كلمة المرور الجديدة</span>
        <input type="password" id="cp-new" autocomplete="new-password" required minlength="6" dir="ltr" /></label>
      <label class="field"><span>تأكيد كلمة المرور الجديدة</span>
        <input type="password" id="cp-confirm" autocomplete="new-password" required minlength="6" dir="ltr" /></label>
      <p class="form-hint">6 أحرف على الأقل.</p>
      <p id="cp-error" class="form-error hidden"></p>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" id="cp-cancel">إلغاء</button>
        <button type="submit" class="btn btn-primary" id="cp-save">${ic("save")} حفظ</button>
      </div>
    </form>`);

  const target = () => (isAdmin ? $("#cp-user").value : me.username);
  const isSelf = () => target() === me.username;
  const syncCurrent = () => {
    $("#cp-current-wrap").classList.toggle("hidden", !isSelf());
    $("#cp-current").required = isSelf();
  };
  if (isAdmin) $("#cp-user").addEventListener("change", syncCurrent);
  syncCurrent();

  $("#cp-close").addEventListener("click", closeModal);
  $("#cp-cancel").addEventListener("click", closeModal);

  $("#cp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#cp-error");
    const fail = (msg) => { errEl.textContent = msg; errEl.classList.remove("hidden"); };
    errEl.classList.add("hidden");
    const next = $("#cp-new").value;
    if (next !== $("#cp-confirm").value) return fail("كلمتا المرور الجديدتان غير متطابقتين");
    const btn = $("#cp-save");
    btn.disabled = true;
    try {
      const username = target();
      const self = isSelf();
      const ref = doc(db, "users", username);
      if (self) {
        const snap = await getDoc(ref);
        if (!snap.exists() || snap.data().passHash !== await sha256($("#cp-current").value))
          return fail("كلمة المرور الحالية غير صحيحة");
      }
      await setDoc(ref, { passHash: await sha256(next) }, { merge: true });
      closeModal();
      toast(self ? "تم تغيير كلمة المرور" : "تم تغيير كلمة مرور الحساب");
    } catch {
      fail("تعذر حفظ كلمة المرور — تحقق من الاتصال");
    } finally {
      btn.disabled = false;
    }
  });
});

// ─────────────── الدخول ───────────────

// قائمة الحسابات: مسؤول التدريب + الأقسام السبعة
$("#login-username").innerHTML =
  `<option value="admin">مسؤول التدريب</option>` +
  DEPARTMENTS.map((d) => `<option value="${d.id}">قسم ${d.ar} — ${d.en}</option>`).join("");

$$(".tab").forEach((tab) => tab.addEventListener("click", () => {
  $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
  $$(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== tab.dataset.tab));
}));

$("#toggle-password").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  const input = $("#login-password");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.setAttribute("aria-pressed", String(show));
  btn.setAttribute("aria-label", show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
  btn.querySelector(".eye-open").classList.toggle("hidden", show);
  btn.querySelector(".eye-closed").classList.toggle("hidden", !show);
  input.focus();
});

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
        <h3 class="card-title">مرحبًا ${esc(t.name)}</h3>
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
// للمسؤول: كل المتدربين + ملخص تقييمات المتدرب المختار
// للقسم: متدربو القسم + نموذج تقييم مباشر للمتدرب المختار

let dashPeriod = 3;        // فترة مخطط توزيع الأقسام بالأشهر — 0 = الكل
let dashFilter = "all";    // all | active | done | pending
let dashSelected = null;   // معرّف المتدرب المختار في الجدول

const STATUS = {
  upcoming: { label: "لم يبدأ",          cls: "badge-gray" },
  active:   { label: "جارٍ",             cls: "badge-blue" },
  pending:  { label: "بانتظار التقييم",  cls: "badge-amber" },
  done:     { label: "مكتمل",            cls: "badge-green" },
};

// صف المتدرب في الجدول: القسم، التقدم، التقييم، والحالة — حسب نوع الحساب
function traineeRow(t, evals, me, today) {
  const isAdmin = me.role === "admin";
  const tEvals = evals.filter((e) => e.traineeId === t.id);
  let from = t.startDate, to = traineeEndISO(t), deptLabel, evalDone;
  if (isAdmin) {
    const cur = t.schedule.find((s) => s.from <= today && s.to >= today);
    deptLabel = cur ? deptById(cur.dept).ar
      : today < t.startDate ? `يبدأ في ${deptById(t.deptIds[0]).ar}` : "أنهى التدريب";
    evalDone = t.deptIds.length > 0 && t.deptIds.every((d) => tEvals.some((e) => e.dept === d));
  } else {
    const seg = t.schedule.find((s) => s.dept === me.dept);
    if (seg) { from = seg.from; to = seg.to; }
    deptLabel = deptById(me.dept).ar;
    evalDone = tEvals.length > 0;
  }
  const span = Math.max(1, parseISO(to) - parseISO(from) + 86400000);
  const progress = today < from ? 0 : today > to ? 100
    : Math.round(((parseISO(today) - parseISO(from) + 86400000) / span) * 100);
  const status = evalDone ? "done" : today < from ? "upcoming" : today > to ? "pending" : "active";
  return { t, tEvals, deptLabel, progress, avg: avgOf(tEvals), status, evalDone };
}

async function renderDashboard({ focusForm = false } = {}) {
  const me = session.user, isAdmin = me.role === "admin";
  const viewId = currentView;
  const [allTrainees, evals] = await Promise.all([
    fetchTrainees(), fetchEvaluations(isAdmin ? null : { dept: me.dept }),
  ]);
  const trainees = isAdmin ? allTrainees : allTrainees.filter((t) => t.deptIds.includes(me.dept));
  const today = todayISO();
  const rows = trainees.map((t) => traineeRow(t, evals, me, today));

  const avgAll = avgOf(evals);
  const count = (st) => rows.filter((r) => r.status === st).length;
  if (focusForm && !isAdmin) {
    // «تقييم جديد»: أول متدرب لم يُقيَّم بعد، وإلا أول متدرب
    dashSelected = (rows.find((r) => r.status === "pending") || rows.find((r) => !r.evalDone) || rows[0])?.t.id ?? null;
  }
  if (!rows.some((r) => r.t.id === dashSelected)) dashSelected = null;

  if (currentView !== viewId) return; // تجاهل النتيجة إذا انتقل المستخدم لشاشة أخرى
  const kpi = (icon, tone, label, value, foot) => `
    <div class="card stat-tile">
      <div class="stat-icon ${tone}">${ic(icon, 22)}</div>
      <div class="stat-body">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        <div class="stat-foot">${foot}</div>
      </div>
    </div>`;
  const avgRating = ratingForAvg(avgAll);
  const filters = [["all", "الكل"], ["active", "جارٍ"], ["done", "مكتمل"], ["pending", "بانتظار التقييم"]];

  $("#content").innerHTML = `
    <div class="view">
      <section class="grid grid-stats stagger" aria-label="المؤشرات">
        ${kpi("users", "green", "إجمالي المتدربين", `<span data-count="${rows.length}">0</span>`, isAdmin ? "في السجل" : `في قسم ${deptById(me.dept).ar}`)}
        ${kpi("star", "gold", "متوسط التقييم", `${fmtAvg(avgAll)}<small> من ${MAX_SCORE}</small>`, avgRating ? `تقدير ${avgRating.ar}` : "لا توجد تقييمات بعد")}
        ${kpi("checkCircle", "green", "المكتمل", `<span data-count="${count("done")}">0</span>`, isAdmin ? "قيّمته كل أقسامه" : "قيّمه القسم")}
        ${kpi("hourglass", "gold", "بانتظار التقييم", `<span data-count="${count("pending")}">0</span>`, "انتهت فترته ولم يُقيَّم")}
      </section>

      <div class="dash-grid">
        <section class="card" aria-labelledby="dash-tbl-title">
          <div class="card-head">
            <div>
              <h3 class="card-title" id="dash-tbl-title">${isAdmin ? "المتدربون" : "متدربو القسم"}</h3>
              <p class="card-sub">اختر متدربًا من الجدول ${isAdmin ? "لعرض ملخص تقييماته" : "لتقييمه"}</p>
            </div>
            <div class="seg" id="dash-filter" role="group" aria-label="تصفية حسب الحالة">
              ${filters.map(([v, l]) => `<button type="button" data-f="${v}" class="${dashFilter === v ? "on" : ""}" aria-pressed="${dashFilter === v}">${l}</button>`).join("")}
            </div>
          </div>
          <div id="dash-table"></div>
        </section>
        <section class="card side-panel" id="dash-side" aria-live="polite"></section>
      </div>

      ${isAdmin ? `
      <div class="grid grid-2 dash-charts">
        <section class="card">
          <div class="card-head">
            <div><h3 class="card-title">توزيع المتدربين على الأقسام</h3>
              <p class="card-sub">المتدربون الذين تتقاطع فترتهم مع ${dashPeriod ? `آخر ${durationLabel(dashPeriod)}` : "كامل السجل"}</p></div>
            <div class="seg" id="dash-period">${[[1, "شهر"], [3, "3 أشهر"], [6, "6 أشهر"], [0, "الكل"]]
              .map(([v, l]) => `<button type="button" data-p="${v}" class="${dashPeriod === v ? "on" : ""}" aria-pressed="${dashPeriod === v}">${l}</button>`).join("")}</div>
          </div>
          <div id="dash-dept-chart"></div>
        </section>
        <section class="card">
          <h3 class="card-title">تسجيلات جديدة شهريًا</h3>
          <p class="card-sub">عدد المتدربين الجدد في آخر 6 أشهر</p>
          <div id="dash-month-chart"></div>
        </section>
      </div>` : ""}
    </div>`;

  $$("#content [data-count]").forEach((el) => animateCount(el, Number(el.dataset.count)));

  // ── الجدول
  const drawTable = () => {
    const q = searchQ();
    const list = rows.filter((r) =>
      (dashFilter === "all" || r.status === dashFilter) &&
      (!q || r.t.name.toLowerCase().includes(q) || r.t.nationalId.includes(q)));
    $("#dash-table").innerHTML = !list.length
      ? `<div class="empty-state"><div class="big">${ic("search", 30)}</div>لا يوجد متدربون مطابقون</div>`
      : `<div class="table-wrap"><table class="tbl tbl-select">
          <thead><tr><th>المتدرب</th><th>القسم</th><th>التقدم</th><th>التقييم</th><th>الحالة</th></tr></thead>
          <tbody>${list.map((r) => `
            <tr data-id="${r.t.id}" tabindex="0" class="${r.t.id === dashSelected ? "selected" : ""}" aria-selected="${r.t.id === dashSelected}">
              <td><div class="person">
                <span class="avatar-initial" aria-hidden="true">${esc(r.t.name.trim().charAt(0) || "؟")}</span>
                <span><b>${esc(r.t.name)}</b><small class="num">${esc(r.t.nationalId)}</small></span>
              </div></td>
              <td>${esc(r.deptLabel)}</td>
              <td><div class="progress" role="progressbar" aria-valuenow="${r.progress}" aria-valuemin="0" aria-valuemax="100" aria-label="تقدم التدريب">
                <div class="progress-track"><div class="progress-fill" style="width:${r.progress}%"></div></div>
                <span class="progress-val">${r.progress}%</span></div></td>
              <td>${r.avg == null ? `<span class="muted">—</span>` : `<span class="score">${ic("star", 14)} ${fmtAvg(r.avg)}</span>`}</td>
              <td><span class="badge ${STATUS[r.status].cls}">${STATUS[r.status].label}</span></td>
            </tr>`).join("")}</tbody></table></div>`;
    $$("#dash-table tr[data-id]").forEach((tr) => {
      const pick = () => { dashSelected = tr.dataset.id; drawTable(); drawSide(); };
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
  };

  // ── العمود الجانبي
  const drawSide = () => {
    const side = $("#dash-side");
    const r = rows.find((x) => x.t.id === dashSelected);
    if (!r) {
      side.innerHTML = `<div class="empty-state">
        <div class="big">${ic(isAdmin ? "clipboard" : "pen", 30)}</div>
        <b>${isAdmin ? "ملخص التقييم" : "نموذج التقييم"}</b><br>اختر متدربًا من الجدول</div>`;
      return;
    }
    if (isAdmin) {
      const t = r.t;
      side.innerHTML = `
        <div class="side-head">
          <span class="avatar-initial lg" aria-hidden="true">${esc(t.name.trim().charAt(0))}</span>
          <div><h3 class="card-title">${esc(t.name)}</h3>
            <p class="card-sub">${fmtDate(t.startDate)} — ${fmtDate(traineeEndISO(t))} · ${durationLabel(t.months)}</p></div>
        </div>
        <div class="avg-box">
          <span>المعدل العام</span>
          <b>${fmtAvg(r.avg)}<small> من ${MAX_SCORE}</small></b>
          <span class="badge ${r.avg == null ? "badge-gray" : "badge-gold"}">${ratingForAvg(r.avg)?.ar || "لم يُقيَّم"}</span>
        </div>
        <ul class="dept-scores">
          ${t.deptIds.map((d) => {
            const ev = r.tEvals.find((e) => e.dept === d), a = evalAvg(ev);
            return `<li><span>${deptById(d).ar} <small>${deptById(d).en}</small></span>
              ${ev ? `<span class="score">${ic("star", 14)} ${fmtAvg(a)}</span>` : `<span class="badge badge-gray">لم يُقيَّم</span>`}</li>`;
          }).join("")}
        </ul>
        <div class="side-actions">
          <button type="button" class="btn btn-outline btn-sm" id="ds-view">${ic("eye", 15)} التفاصيل</button>
          <button type="button" class="btn btn-outline btn-sm" id="ds-evals" ${r.tEvals.length ? "" : "disabled"}>${ic("clipboard", 15)} كل التقييمات</button>
          <button type="button" class="btn btn-primary btn-sm" id="ds-print" ${r.tEvals.length ? "" : "disabled"}>${ic("file", 15)} التقرير النهائي</button>
        </div>`;
      $("#ds-view").addEventListener("click", () => openTraineeModal(t));
      $("#ds-evals").addEventListener("click", () => openEvaluationsModal(t, r.tEvals));
      $("#ds-print").addEventListener("click", () => printFinalReport(t, r.tEvals));
    } else {
      const existing = r.tEvals[0];
      side.innerHTML = `
        <div class="side-head">
          <span class="avatar-initial lg" aria-hidden="true">${esc(r.t.name.trim().charAt(0))}</span>
          <div><h3 class="card-title">تقييم: ${esc(r.t.name)}</h3>
            <p class="card-sub">قسم ${deptById(me.dept).ar} · ${existing ? "تعديل تقييم محفوظ" : "تقييم جديد"}</p></div>
        </div>
        ${evalFormHTML(existing)}`;
      bindEvalForm(side, r.t, existing, () => renderDashboard());
    }
  };

  // ── المخططات (للمسؤول)
  const drawCharts = () => {
    const inPeriod = (t) => {
      if (!dashPeriod) return true;
      const from = toISO(addMonths(new Date(), -dashPeriod));
      return traineeEndISO(t) >= from && t.startDate <= today;
    };
    const list = trainees.filter(inPeriod);
    const deptCounts = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, 0]));
    list.forEach((t) => t.deptIds.forEach((d) => { if (d in deptCounts) deptCounts[d]++; }));
    const maxDept = Math.max(1, ...Object.values(deptCounts));
    $("#dash-dept-chart").innerHTML = `<div class="hbar-list">${DEPARTMENTS.map((d) => `
      <div class="hbar" title="${d.ar}: ${deptCounts[d.id]} متدرب">
        <div class="hbar-name">${d.ar}<small>${d.en}</small></div>
        <div class="hbar-track"><div class="hbar-fill ${deptCounts[d.id] ? "" : "zero"}" style="width:${(deptCounts[d.id] / maxDept) * 100}%"></div></div>
        <div class="hbar-val">${deptCounts[d.id]}</div>
      </div>`).join("")}</div>`;

    const monthCols = [];
    for (let i = 5; i >= 0; i--) {
      const d = addMonths(new Date(), -i);
      monthCols.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTH_AR[d.getMonth()], count: 0 });
    }
    trainees.forEach((t) => { const m = monthCols.find((c) => t.startDate?.startsWith(c.key)); if (m) m.count++; });
    const maxMonth = Math.max(1, ...monthCols.map((c) => c.count));
    $("#dash-month-chart").innerHTML = `
      <div class="vbar-wrap">${monthCols.map((c) => `
        <div class="vbar-col" title="${c.label}: ${c.count}">
          <div class="vbar-num">${c.count}</div>
          <div class="vbar" style="height:${(c.count / maxMonth) * 100}%"></div>
        </div>`).join("")}</div>
      <div class="vbar-labels">${monthCols.map((c) => `<span>${c.label}</span>`).join("")}</div>`;
  };

  $$("#dash-filter button").forEach((b) => b.addEventListener("click", () => {
    dashFilter = b.dataset.f;
    $$("#dash-filter button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
    drawTable();
  }));
  searchHandler = drawTable;
  drawTable();
  drawSide();
  if (isAdmin) {
    drawCharts();
    $$("#dash-period button").forEach((b) => b.addEventListener("click", () => {
      dashPeriod = Number(b.dataset.p);
      $$("#dash-period button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
      $("#dash-period").closest(".card").querySelector(".card-sub").textContent =
        `المتدربون الذين تتقاطع فترتهم مع ${dashPeriod ? `آخر ${durationLabel(dashPeriod)}` : "كامل السجل"}`;
      drawCharts();
    }));
  }
  if (focusForm && dashSelected) $("#dash-side .rate-btn")?.focus();
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
            <button type="button" class="dept-chip all on" data-all>${ic("check", 15)} كل الأقسام</button>
            ${DEPARTMENTS.map((d) => `<button type="button" class="dept-chip on" data-dept="${d.id}">${d.ar} · ${d.en}</button>`).join("")}
          </div>
          <p class="form-hint">اختر «كل الأقسام» أو انقر الأقسام المطلوبة فقط — الترتيب حسب تسلسل الأقسام</p>
        </div>

        <div class="card" style="background:var(--surface-2); box-shadow:none" id="schedule-preview"></div>

        <div class="modal-foot" style="justify-content:flex-start">
          <button type="submit" class="btn btn-primary" id="reg-submit">${ic("save")} حفظ وتوليد الجدول</button>
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

  if (currentView !== "trainees") return; // تجاهل النتيجة إذا انتقل المستخدم لشاشة أخرى
  $("#content").innerHTML = `
    <div class="view card">
      <div class="card-head">
        <div><h3 class="card-title">سجل المتدربين</h3>
          <p class="card-sub" style="margin:0">ابحث بالاسم أو رقم الهوية من شريط البحث أعلى الصفحة، أو صفِّ حسب فترة التدريب</p></div>
      </div>
      <div class="search-bar">
        <label class="field field-inline"><span>من</span><input id="q-from" type="date" aria-label="تدريب يتقاطع مع الفترة من" /></label>
        <label class="field field-inline"><span>إلى</span><input id="q-to" type="date" aria-label="إلى" /></label>
        <button type="button" class="btn btn-outline btn-sm" id="q-clear">${ic("close", 15)} مسح التصفية</button>
      </div>
      <div id="trainee-table"></div>
    </div>`;


  const draw = () => {
    const txt = searchQ();
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
      ? `<div class="empty-state"><div class="big">${ic("search", 34)}</div>لا توجد نتائج مطابقة</div>`
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
                <button class="btn btn-outline btn-sm" data-act="view" data-id="${t.id}">${ic("eye", 15)} التفاصيل</button>
                <button class="btn btn-outline btn-sm" data-act="edit" data-id="${t.id}">${ic("edit", 15)} تعديل</button>
                <button class="btn btn-outline btn-sm" data-act="sheet" data-id="${t.id}">${ic("printer", 15)} Time Sheet</button>
                <button class="btn btn-ghost btn-sm danger" data-act="del" data-id="${t.id}" aria-label="حذف المتدرب" title="حذف">${ic("trash", 16)}</button>
              </div></td></tr>`;
          }).join("")}</tbody></table></div>`;

    $$("#trainee-table [data-act]").forEach((b) => b.addEventListener("click", () => {
      const t = trainees.find((x) => x.id === b.dataset.id);
      if (b.dataset.act === "view") openTraineeModal(t);
      if (b.dataset.act === "edit") openEditModal(t, trainees);
      if (b.dataset.act === "sheet") printTimesheet(t);
      if (b.dataset.act === "del") confirmDelete(t);
    }));
  };

  ["q-from", "q-to"].forEach((id) => $("#" + id).addEventListener("input", draw));
  $("#q-clear").addEventListener("click", () => { $("#top-search").value = $("#q-from").value = $("#q-to").value = ""; draw(); });
  searchHandler = draw;
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

function openEditModal(t, trainees) {
  const selMonths = DURATIONS.find((d) => d.months === t.months) ? t.months : "custom";
  const customMonths = selMonths === "custom" ? t.months : 1;

  openModal(`
    <div class="modal-head"><h3>${ic("edit", 20)} تعديل بيانات المتدرب</h3>
      <button class="icon-btn" id="ed-close" aria-label="إغلاق">${ic("close")}</button></div>
    <form id="edit-form">
      <div class="field-row">
        <label class="field"><span>اسم المتدرب</span>
          <input id="ed-name" required value="${esc(t.name)}" /></label>
        <label class="field"><span>رقم الهوية</span>
          <input id="ed-nid" required inputmode="numeric" dir="ltr" value="${esc(t.nationalId)}" /></label>
      </div>
      <div class="field-row">
        <label class="field"><span>تاريخ بداية التدريب</span>
          <input id="ed-start" type="date" required value="${t.startDate}" /></label>
        <label class="field"><span>مدة التدريب</span>
          <select id="ed-months">
            ${DURATIONS.map((d) => `<option value="${d.months}" ${d.months === t.months ? "selected" : ""}>${d.label}</option>`).join("")}
            <option value="custom" ${selMonths === "custom" ? "selected" : ""}>مدة أخرى…</option>
          </select></label>
      </div>
      <label class="field ${selMonths !== "custom" ? "hidden" : ""}" id="ed-custom-wrap"><span>عدد الأشهر</span>
        <input id="ed-custom-months" type="number" min="1" max="24" value="${customMonths}" /></label>

      <div class="field">
        <span>الأقسام</span>
        <div class="dept-picker" id="ed-depts">
          <button type="button" class="dept-chip ${t.deptIds.length === DEPARTMENTS.length ? "on" : ""} all" data-all>${ic("check", 15)} كل الأقسام</button>
          ${DEPARTMENTS.map((d) => `<button type="button" class="dept-chip ${t.deptIds.includes(d.id) ? "on" : ""}" data-dept="${d.id}">${d.ar} · ${d.en}</button>`).join("")}
        </div>
      </div>

      <div class="card" style="background:var(--surface-2);box-shadow:none" id="ed-preview"></div>

      <p id="ed-error" class="form-error hidden"></p>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" id="ed-cancel">إلغاء</button>
        <button type="submit" class="btn btn-primary" id="ed-save">${ic("save")} حفظ التعديلات</button>
      </div>
    </form>`);

  const edMonths = () => $("#ed-months").value === "custom"
    ? Math.max(1, Number($("#ed-custom-months").value) || 1)
    : Number($("#ed-months").value);
  const edDepts = () => $$("#ed-depts .dept-chip[data-dept].on").map((c) => c.dataset.dept);

  const preview = () => {
    const months = edMonths(), depts = edDepts(), start = $("#ed-start").value, box = $("#ed-preview");
    if (!start || !depts.length) { box.innerHTML = `<p class="muted" style="margin:0">اختر التاريخ والأقسام لعرض معاينة الجدول</p>`; return; }
    const sched = generateSchedule(start, months, depts);
    box.innerHTML = `<h4 style="margin:0 0 10px;font-size:14px">معاينة الجدول التدريبي</h4>` + scheduleTimelineHTML({ schedule: sched });
  };

  $("#ed-months").addEventListener("change", () => {
    $("#ed-custom-wrap").classList.toggle("hidden", $("#ed-months").value !== "custom");
    preview();
  });
  $("#ed-custom-months").addEventListener("input", preview);
  $("#ed-start").addEventListener("change", preview);

  const allChip = $("#ed-depts [data-all]");
  const syncAll = () => allChip.classList.toggle("on", edDepts().length === DEPARTMENTS.length);
  allChip.addEventListener("click", () => {
    const on = !allChip.classList.contains("on");
    $$("#ed-depts .dept-chip[data-dept]").forEach((c) => c.classList.toggle("on", on));
    syncAll(); preview();
  });
  $$("#ed-depts .dept-chip[data-dept]").forEach((c) => c.addEventListener("click", () => {
    c.classList.toggle("on"); syncAll(); preview();
  }));
  preview();

  $("#ed-close").addEventListener("click", closeModal);
  $("#ed-cancel").addEventListener("click", closeModal);

  $("#edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#ed-error");
    errEl.classList.add("hidden");
    const depts = edDepts();
    if (!depts.length) { errEl.textContent = "اختر قسمًا واحدًا على الأقل"; errEl.classList.remove("hidden"); return; }
    const newNid = $("#ed-nid").value.trim();
    const dupCheck = newNid !== t.nationalId
      ? trainees.find((x) => x.id !== t.id && x.nationalId === newNid)
      : null;
    if (dupCheck) { errEl.textContent = "رقم الهوية مستخدم من قِبل متدرب آخر"; errEl.classList.remove("hidden"); return; }
    const btn = $("#ed-save");
    btn.disabled = true;
    try {
      const months = edMonths();
      const startDate = $("#ed-start").value;
      await setDoc(doc(db, "trainees", t.id), {
        name: $("#ed-name").value.trim(),
        nationalId: newNid,
        startDate, months,
        deptIds: depts,
        schedule: generateSchedule(startDate, months, depts),
        createdAt: t.createdAt ?? null,
        updatedAt: serverTimestamp(),
      });
      closeModal();
      toast("تم حفظ التعديلات بنجاح");
      go("trainees");
    } catch { toast("تعذر الحفظ — تحقق من الاتصال", "err"); btn.disabled = false; }
  });
}

async function openTraineeModal(t) {
  const evals = await fetchEvaluations({ traineeId: t.id });
  const evaluatedDepts = new Set(evals.map((e) => e.dept));
  openModal(`
    <div class="modal-head"><h3>${ic("user", 20)} ${esc(t.name)}</h3>
      <button class="icon-btn" id="tm-close" aria-label="إغلاق">${ic("close")}</button></div>
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
      <button class="btn btn-outline" id="tm-sheet">${ic("printer")} طباعة Time Sheet</button>
      <button class="btn btn-primary" id="tm-report" ${evals.length ? "" : "disabled"}>${ic("file")} التقرير النهائي</button>
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

  if (currentView !== "reports") return; // تجاهل النتيجة إذا انتقل المستخدم لشاشة أخرى
  $("#content").innerHTML = `
    <div class="view card">
      <div class="card-head">
        <div><h3 class="card-title">تقييمات الأقسام مجمعة</h3>
          <p class="card-sub" style="margin:0">ابحث باسم المتدرب أو صفِّ حسب القسم، ثم صدّر التقرير النهائي</p></div>
      </div>
      <div class="search-bar">
        <label class="field field-inline"><span>القسم</span>
          <select id="r-dept">
            <option value="">كل الأقسام</option>
            ${DEPARTMENTS.map((d) => `<option value="${d.id}">${d.ar} · ${d.en}</option>`).join("")}
          </select></label>
      </div>
      <div id="report-table"></div>
    </div>`;

  const draw = () => {
    const txt = searchQ();
    const dept = $("#r-dept").value;
    const list = trainees.filter((t) => {
      const tEvals = byTrainee[t.id] || [];
      const matchTxt = !txt || t.name.toLowerCase().includes(txt);
      const matchDept = !dept || tEvals.some((e) => e.dept === dept);
      return matchTxt && matchDept;
    });
    $("#report-table").innerHTML = !list.length
      ? `<div class="empty-state"><div class="big">${ic("clipboard", 34)}</div>لا توجد نتائج</div>`
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
                <button class="btn btn-primary btn-sm" data-print="${t.id}" ${done ? "" : "disabled"}>${ic("file", 15)} تصدير التقرير</button>
              </div></td></tr>`;
          }).join("")}</tbody></table></div>`;

    $$("#report-table [data-view]").forEach((b) => b.addEventListener("click", () =>
      openEvaluationsModal(trainees.find((t) => t.id === b.dataset.view), byTrainee[b.dataset.view] || [])));
    $$("#report-table [data-print]").forEach((b) => b.addEventListener("click", () =>
      printFinalReport(trainees.find((t) => t.id === b.dataset.print), byTrainee[b.dataset.print] || [])));
  };
  $("#r-dept").addEventListener("change", draw);
  searchHandler = draw;
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
    <div class="modal-head"><h3>${ic("clipboard", 20)} تقييمات ${esc(t.name)}</h3>
      <button class="icon-btn" id="em-close" aria-label="إغلاق">${ic("close")}</button></div>
    ${evals.length ? evalMatrixHTML(t, evals) : `<div class="empty-state"><div class="big">${ic("pen", 34)}</div>لم يسجَّل أي تقييم بعد</div>`}
    <div class="modal-foot">
      <button class="btn btn-primary" id="em-print" ${evals.length ? "" : "disabled"}>${ic("file")} تصدير التقرير النهائي</button>
    </div>`);
  $("#em-close").addEventListener("click", closeModal);
  $("#em-print").addEventListener("click", () => printFinalReport(t, evals));
}

// ═══════════════ واجهة القسم ═══════════════

// ─────────────── دليل المستخدم ───────────────

function renderGuide() {
  const isAdmin = session.user.role === "admin";
  const step = (items) => `<ol class="guide-steps">${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
  const go_ = (view, label) => `<button type="button" class="btn btn-outline btn-sm" data-goto="${view}">${label} ${ic("arrowRight", 14)}</button>`;

  const sections = isAdmin ? [
    { icon: "dashboard", title: "لوحة المعلومات", body: `
      <p>أربع بطاقات مؤشرات: إجمالي المتدربين، متوسط التقييم، المكتمل (قيّمته كل أقسامه)، وبانتظار التقييم (انتهت فترته ولم تكتمل تقييماته).</p>
      ${step([
        "صفِّ جدول المتدربين بأزرار الحالة: الكل، جارٍ، مكتمل، بانتظار التقييم.",
        "اضغط على أي متدرب ليظهر بجانب الجدول ملخص تقييماته: المعدل العام ومعدل كل قسم، مع أزرار التفاصيل والتقرير النهائي.",
        "أسفل اللوحة مخطط توزيع المتدربين على الأقسام (اختر الفترة من أزراره) ومخطط التسجيلات الشهرية.",
      ])}
      ${go_("dashboard", "افتح لوحة المعلومات")}` },
    { icon: "userPlus", title: "تسجيل متدرب جديد", body: `
      ${step([
        "أدخل اسم المتدرب ورقم الهوية (لا يتكرر رقم الهوية بين متدربين).",
        "اختر تاريخ بداية التدريب ومدته، أو «مدة أخرى…» لتحديد عدد الأشهر يدويًا.",
        "اختر الأقسام التي سيتدرب فيها، أو «كل الأقسام».",
        "راجع معاينة الجدول، ثم اضغط <b>حفظ وتوليد الجدول</b>.",
      ])}
      <p class="guide-note">${ic("lightbulb", 16)} يوزّع النظام مدة التدريب بالتساوي على الأقسام المختارة بالترتيب، وأيام الدوام من الأحد إلى الخميس.</p>
      ${go_("register", "سجّل متدربًا")}` },
    { icon: "users", title: "المتدربون والبحث", body: `
      <p>ابحث بالاسم أو رقم الهوية من شريط البحث أعلى الصفحة، أو حدّد نطاق تاريخ. لكل متدرب الأزرار التالية:</p>
      <ul class="guide-list">
        <li><b>التفاصيل:</b> الجدول التدريبي وحالة التقييم في كل قسم.</li>
        <li><b>تعديل:</b> تغيير البيانات أو المدة أو الأقسام، ويُعاد توليد الجدول تلقائيًا.</li>
        <li><b>Time Sheet:</b> طباعة كشف الحضور الشهري، أو حفظه PDF من نافذة الطباعة.</li>
        <li><b>حذف:</b> يطلب تأكيدًا قبل الحذف.</li>
      </ul>
      ${go_("trainees", "افتح قائمة المتدربين")}` },
    { icon: "clipboard", title: "التقارير والتقرير النهائي", body: `
      <p>يتابع العمود «التقدم» عدد الأقسام التي قيّمت المتدرب من إجمالي أقسامه.</p>
      ${step(["اضغط <b>عرض التقييمات</b> لرؤية تقييم كل قسم وملاحظاته.", "اضغط <b>تصدير التقرير</b> لطباعة التقرير النهائي أو حفظه PDF (يتفعّل بعد أول تقييم)."])}
      ${go_("reports", "افتح التقارير")}` },
    { icon: "key", title: "كلمات المرور والحسابات", body: `
      <p>من زر <b>تغيير كلمة المرور</b> أسفل القائمة الجانبية:</p>
      <ul class="guide-list">
        <li>لحسابك: أدخل كلمتك الحالية ثم الجديدة مرتين.</li>
        <li>لحساب قسم: اختره من القائمة واكتب كلمة جديدة بدون الحاجة لكلمته الحالية.</li>
      </ul>
      <p class="guide-note">${ic("lightbulb", 16)} غيّر كلمات المرور الافتراضية لكل الحسابات بعد أول دخول.</p>` },
    { icon: "search", title: "استعلام المتدرب", body: `
      <p>يستطيع المتدرب معرفة جدوله بدون حساب: من شاشة الدخول يختار تبويب <b>استعلام المتدرب</b> ويكتب رقم هويته.</p>` },
  ] : [
    { icon: "dashboard", title: "لوحة المعلومات", body: `
      <p>مؤشرات قسمك: إجمالي المتدربين، متوسط التقييم، المكتمل، وبانتظار التقييم. تحتها جدول متدربي القسم وبجانبه نموذج التقييم.</p>
      ${go_("dashboard", "افتح لوحة المعلومات")}` },
    { icon: "pen", title: "تقييم متدرب", body: `
      ${step([
        "اضغط <b>تقييم جديد</b> في الترويسة أو القائمة، أو اختر المتدرب من جدول لوحة المعلومات.",
        "اختر درجة من 1 إلى 4 لكل معيار: 1 مقبول، 2 جيد، 3 جيد جدًا، 4 ممتاز.",
        "يظهر المعدل محسوبًا تلقائيًا تحت المعايير.",
        "أضف اسم المُقيِّم والملاحظات إن وجدت، ثم اضغط <b>حفظ التقييم</b>. تقدر تعدّله لاحقًا بنفس الطريقة.",
      ])}
      ${go_("newEval", "ابدأ تقييمًا")}` },
    { icon: "users", title: "المتدربون", body: `
      <p>قائمة المتدربين المجدولين في قسمك مع فترة كل واحد في القسم وحالة تقييمه: <span class="badge badge-amber">بانتظار التقييم</span> أو <span class="badge badge-green">مُقيَّم</span>.</p>
      ${go_("deptTrainees", "افتح المتدربين")}` },
    { icon: "key", title: "تغيير كلمة المرور", body: `
      <p>من زر <b>تغيير كلمة المرور</b> أسفل القائمة الجانبية: أدخل كلمتك الحالية ثم الجديدة مرتين. إذا نسيت كلمتك، اطلب من مسؤول التدريب إعادة تعيينها.</p>` },
  ];

  const scale = `
    <div class="guide-scale">
      <div><h4>معايير التقييم</h4><ul class="guide-list">${CRITERIA.map((c) => `<li>${c.ar} <small class="muted">${c.en}</small></li>`).join("")}</ul></div>
      <div><h4>التقديرات</h4><div class="dept-picker">${RATINGS.map((r) => `<span class="badge badge-blue">${r.ar} · ${r.en}</span>`).join("")}</div></div>
    </div>`;

  $("#content").innerHTML = `
    <div class="view">
      <div class="card guide-hero">
        <div class="guide-hero-icon">${ic("book", 26)}</div>
        <div>
          <h3 class="card-title">دليل المستخدم</h3>
          <p class="card-sub">${isAdmin ? "كل ما يحتاجه مسؤول التدريب لإدارة المتدربين والجداول والتقارير." : "خطوات متابعة متدربي قسمك وتسجيل تقييماتهم."}</p>
        </div>
      </div>
      <div class="guide-list-wrap stagger">
        ${sections.map((s, i) => `
          <details class="card guide-item" ${i === 0 ? "open" : ""}>
            <summary><span class="guide-ic">${ic(s.icon, 19)}</span><span class="guide-title">${s.title}</span><span class="guide-chev">${ic("chevron", 18)}</span></summary>
            <div class="guide-body">${s.body}</div>
          </details>`).join("")}
        <details class="card guide-item">
          <summary><span class="guide-ic">${ic("checkCircle", 19)}</span><span class="guide-title">معايير التقييم والتقديرات</span><span class="guide-chev">${ic("chevron", 18)}</span></summary>
          <div class="guide-body">${scale}</div>
        </details>
        <details class="card guide-item">
          <summary><span class="guide-ic">${ic("search", 19)}</span><span class="guide-title">البحث والجوال والطباعة</span><span class="guide-chev">${ic("chevron", 18)}</span></summary>
          <div class="guide-body">
            <ul class="guide-list">
              <li>شريط البحث في الترويسة يصفّي جدول الصفحة الحالية بالاسم أو رقم الهوية، ومن الصفحات اللي ما فيها جدول ينقلك لقائمة المتدربين.</li>
              <li>على الجوال تصير القائمة شريطًا أفقيًا أعلى الشاشة، اسحبه يمين ويسار لباقي الصفحات.</li>
              <li>لحفظ أي تقرير PDF: اضغط زر الطباعة واختر <b>Save as PDF</b>.</li>
            </ul>
          </div>
        </details>
      </div>
    </div>`;

  $$("#content [data-goto]").forEach((b) => b.addEventListener("click", () => go(b.dataset.goto)));
}

async function renderDeptTrainees() {
  const me = session.user;
  const d = deptById(me.dept);
  const trainees = (await fetchTrainees()).filter((t) => t.deptIds.includes(me.dept));
  const evals = await fetchEvaluations({ dept: me.dept });
  const today = todayISO();

  if (currentView !== "deptTrainees") return; // تجاهل النتيجة إذا انتقل المستخدم لشاشة أخرى
  $("#content").innerHTML = `
    <div class="view card">
      <div class="card-head">
        <div><h3 class="card-title">متدربو قسم ${d.ar} <span class="muted" style="font-size:13px">${d.en}</span></h3>
          <p class="card-sub" style="margin:0">قيّم كل متدرب مرّ على القسم — يمكن تعديل التقييم لاحقًا</p></div>
      </div>
      <div id="dept-table"></div>
    </div>`;

  const draw = () => {
    const txt = searchQ();
    const list = trainees.filter((t) => !txt || t.name.toLowerCase().includes(txt) || t.nationalId.includes(txt));
    $("#dept-table").innerHTML = !list.length
      ? `<div class="empty-state"><div class="big">${ic("users", 34)}</div>لا يوجد متدربون مجدولون في هذا القسم</div>`
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
              <td>${ev ? `<span class="badge badge-green">مُقيَّم · ${fmtAvg(evalAvg(ev))}</span>` : `<span class="badge badge-amber">بانتظار التقييم</span>`}</td>
              <td><button class="btn ${ev ? "btn-outline" : "btn-primary"} btn-sm" data-ev="${t.id}">${ev ? `${ic("edit", 15)} تعديل التقييم` : `${ic("pen", 15)} تقييم`}</button></td>
            </tr>`;
          }).join("")}</tbody></table></div>`;

    $$("#dept-table [data-ev]").forEach((b) => b.addEventListener("click", () => {
      const t = trainees.find((x) => x.id === b.dataset.ev);
      openEvaluationForm(t, evals.find((e) => e.traineeId === t.id));
    }));
  };
  searchHandler = draw;
  draw();
}

// نموذج تقييم: معيار لكل صف، أزرار 1–4 (44px) تقابل التقديرات المحفوظة، والمعدل يُحسب تلقائيًا
function evalFormHTML(existing) {
  return `
    <form class="eval-form" novalidate>
      <p class="rate-legend">${RATINGS.map((r, i) => `<span><b>${i + 1}</b> ${r.ar}</span>`).join("")}</p>
      <div class="rate-grid">
        ${CRITERIA.map((c) => {
          const cur = existing?.scores?.[c.id];
          return `
          <div class="rate-row" data-crit="${c.id}">
            <div class="rate-crit" id="crit-${c.id}">${c.ar}<small>${c.en}</small></div>
            <div class="rate-opts" role="radiogroup" aria-labelledby="crit-${c.id}">
              ${RATINGS.map((r, i) => `<button type="button" class="rate-btn ${cur === r.id ? "on" : ""}" data-r="${r.id}"
                role="radio" aria-checked="${cur === r.id}" aria-label="${i + 1} — ${r.ar}" title="${r.ar} · ${r.en}">${i + 1}</button>`).join("")}
            </div>
          </div>`;
        }).join("")}
      </div>
      <div class="avg-box live" aria-live="polite">
        <span>المعدل المحسوب</span>
        <b class="ef-avg">—<small> من ${MAX_SCORE}</small></b>
        <span class="badge badge-gray ef-avg-label">أكمل المعايير</span>
      </div>
      <label class="field"><span>اسم المُقيِّم (اختياري)</span>
        <input class="ef-name" value="${esc(existing?.evaluatorName || "")}" placeholder="اسم رئيس القسم أو المشرف" /></label>
      <label class="field"><span>ملاحظات (اختياري)</span>
        <textarea class="ef-notes" rows="3" placeholder="ملاحظات إضافية…">${esc(existing?.notes || "")}</textarea></label>
      <p class="form-error hidden ef-error" role="alert"></p>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-block ef-save">${ic("save")} حفظ التقييم</button>
      </div>
    </form>`;
}

function bindEvalForm(root, t, existing, onSaved) {
  const me = session.user;
  const form = $(".eval-form", root);
  const refresh = () => {
    const picked = $$(".rate-row", form).map((row) => $(".rate-btn.on", row)?.dataset.r).filter(Boolean);
    const avg = avgOf([{ scores: Object.fromEntries(picked.map((r, i) => [i, r])) }]);
    $(".ef-avg", form).innerHTML = `${fmtAvg(avg)}<small> من ${MAX_SCORE}</small>`;
    const lbl = $(".ef-avg-label", form);
    const complete = picked.length === CRITERIA.length;
    lbl.textContent = avg == null ? "أكمل المعايير" : `${ratingForAvg(avg).ar}${complete ? "" : ` · ${picked.length}/${CRITERIA.length}`}`;
    lbl.className = `badge ef-avg-label ${complete ? "badge-gold" : "badge-gray"}`;
  };
  $$(".rate-row", form).forEach((row) => {
    const btns = $$(".rate-btn", row);
    btns.forEach((btn, i) => {
      btn.addEventListener("click", () => {
        btns.forEach((o) => { o.classList.toggle("on", o === btn); o.setAttribute("aria-checked", o === btn); });
        row.classList.remove("missing");
        refresh();
      });
      // أسهم لوحة المفاتيح بين أزرار المعيار نفسه
      btn.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
        if (d) { e.preventDefault(); btns[(i + d + btns.length) % btns.length].focus(); }
      });
    });
  });
  refresh();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $(".ef-error", form);
    err.classList.add("hidden");
    const scores = {};
    let firstMissing = null;
    $$(".rate-row", form).forEach((row) => {
      const sel = $(".rate-btn.on", row);
      row.classList.toggle("missing", !sel);
      if (!sel) firstMissing ||= row;
      else scores[row.dataset.crit] = sel.dataset.r;
    });
    if (firstMissing) {
      err.textContent = "الرجاء اختيار درجة لكل المعايير";
      err.classList.remove("hidden");
      $(".rate-btn", firstMissing).focus();
      return;
    }
    const btn = $(".ef-save", form);
    btn.disabled = true;
    try {
      await setDoc(doc(db, "evaluations", `${t.id}_${me.dept}`), {
        traineeId: t.id, dept: me.dept, scores,
        evaluatorName: $(".ef-name", form).value.trim(),
        notes: $(".ef-notes", form).value.trim(),
        updatedAt: serverTimestamp(),
      });
      toast("تم حفظ التقييم بنجاح");
      onSaved?.();
    } catch {
      toast("تعذر حفظ التقييم", "err");
      btn.disabled = false;
    }
  });
}

function openEvaluationForm(t, existing) {
  const me = session.user;
  const d = deptById(me.dept);
  openModal(`
    <div class="modal-head"><h3>${ic("pen", 20)} تقييم: ${esc(t.name)}</h3>
      <button class="icon-btn" id="ev-close" aria-label="إغلاق">${ic("close")}</button></div>
    <p class="card-sub">قسم ${d.ar} — ${d.en} · اختر درجة لكل معيار</p>
    ${evalFormHTML(existing)}`);
  $("#ev-close").addEventListener("click", closeModal);
  bindEvalForm($("#modal"), t, existing, () => { closeModal(); go(currentView); });
}

// ═══════════════ معايير التقييم ═══════════════

function renderCriteria() {
  $("#content").innerHTML = `
    <div class="view grid-2 grid criteria-page">
      <section class="card">
        <h3 class="card-title">معايير التقييم</h3>
        <p class="card-sub">يقيّم كل قسم المتدرب على هذه المعايير عند انتهاء فترته في القسم</p>
        <ol class="criteria-list">
          ${CRITERIA.map((c, i) => `<li><span class="crit-num">${i + 1}</span><span><b>${c.ar}</b><small>${c.en}</small></span></li>`).join("")}
        </ol>
      </section>
      <section class="card">
        <h3 class="card-title">سلّم التقديرات</h3>
        <p class="card-sub">لكل تقدير درجة تُستخدم في حساب المعدل (من ${MAX_SCORE})</p>
        <ul class="scale-list">
          ${RATINGS.map((r, i) => `<li><span class="rate-btn on static">${i + 1}</span><span><b>${r.ar}</b><small>${r.en}</small></span></li>`).join("")}
        </ul>
        <p class="guide-note">${ic("lightbulb", 16)} المعدل = متوسط درجات المعايير. التقرير النهائي المطبوع يعرض التقدير نفسه لكل معيار.</p>
      </section>
    </div>`;
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
