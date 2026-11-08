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
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
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
    { id: "dashboard",  icon: "dashboard", label: "لوحة المعلومات" },
    { id: "register",   icon: "userPlus", label: "تسجيل متدرب" },
    { id: "trainees",   icon: "users", label: "المتدربون والبحث" },
    { id: "reports",    icon: "clipboard", label: "التقييمات والتقارير" },
    { id: "guide",      icon: "book", label: "دليل المستخدم" },
  ],
  dept: [
    { id: "deptTrainees", icon: "users", label: "متدربو القسم" },
    { id: "guide",        icon: "book",  label: "دليل المستخدم" },
  ],
};

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
  show("app-shell");
  go(NAV[u.role][0].id);
}

function go(view) {
  currentView = view;
  $$(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
    if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  const titles = {
    dashboard: "لوحة المعلومات", register: "تسجيل متدرب جديد",
    trainees: "المتدربون والبحث", reports: "التقييمات والتقرير النهائي",
    deptTrainees: "متدربو القسم", guide: "دليل المستخدم",
  };
  $("#topbar-title").textContent = titles[view] || "";
  const c = $("#content");
  c.innerHTML = `<div class="grid stagger"><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:220px"></div></div>`;
  c.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
  ({ dashboard: renderDashboard, register: renderRegister, trainees: renderTrainees,
     reports: renderReports, deptTrainees: renderDeptTrainees, guide: renderGuide }[view])?.();
}

// القائمة الجانبية على الجوال
const closeSidebar = () => { $("#sidebar").classList.remove("open"); $("#sidebar-scrim").classList.add("hidden"); };
$("#menu-btn").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#sidebar-scrim").classList.remove("hidden"); });
$("#sidebar-scrim").addEventListener("click", closeSidebar);

// الوضع الداكن
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("labTheme", t);
  $("#theme-toggle").innerHTML = t === "dark" ? `${ic("sun")}<span>الوضع الفاتح</span>` : `${ic("moon")}<span>الوضع الداكن</span>`;
}
$("#theme-toggle").addEventListener("click", () =>
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
applyTheme(localStorage.getItem("labTheme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

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

  if (currentView !== "dashboard") return; // تجاهل النتيجة إذا انتقل المستخدم لشاشة أخرى
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
        <div class="card stat-tile"><div class="stat-icon">${ic("users", 20)}</div>
          <div class="stat-label">متدربو الفترة</div>
          <div class="stat-value" data-count="${list.length}">0</div>
          <div class="stat-foot">إجمالي السجل: ${trainees.length}</div></div>
        <div class="card stat-tile"><div class="stat-icon green">${ic("activity", 20)}</div>
          <div class="stat-label">على رأس التدريب الآن</div>
          <div class="stat-value" data-count="${active.length}">0</div>
          <div class="stat-foot">حتى ${fmtDate(today)}</div></div>
        <div class="card stat-tile"><div class="stat-icon amber">${ic("graduation", 20)}</div>
          <div class="stat-label">أكملوا التدريب</div>
          <div class="stat-value" data-count="${finished.length}">0</div>
          <div class="stat-foot">ضمن الفترة المحددة</div></div>
        <div class="card stat-tile"><div class="stat-icon violet">${ic("pen", 20)}</div>
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
          <p class="card-sub" style="margin:0">البحث بالاسم أو رقم الهوية أو فترة التدريب</p></div>
        <button class="btn btn-primary btn-sm" id="go-register">${ic("plus", 16)} متدرب جديد</button>
      </div>
      <div class="search-bar">
        <label class="field"><input id="q-text" placeholder="بحث بالاسم أو رقم الهوية…" aria-label="بحث بالاسم أو رقم الهوية" /></label>
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
        <label class="field"><input id="r-text" placeholder="بحث باسم المتدرب…" aria-label="بحث باسم المتدرب" /></label>
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
      <p>نظرة سريعة على أعداد المتدربين: متدربو الفترة، المتدربون على رأس التدريب الآن، من أكملوا التدريب، وعدد التقييمات المسجلة.</p>
      ${step(["اختر الفترة من الأزرار أعلى اللوحة (شهر، شهران، 3 أشهر، 6 أشهر، الكل).", "تتحدث البطاقات والمخططات حسب الفترة المختارة."])}
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
      <p>ابحث بالاسم أو رقم الهوية، أو حدّد نطاق تاريخ. لكل متدرب الأزرار التالية:</p>
      <ul class="guide-list">
        <li><b>التفاصيل:</b> الجدول التدريبي وحالة التقييم في كل قسم.</li>
        <li><b>تعديل:</b> تغيير البيانات أو المدة أو الأقسام، ويُعاد توليد الجدول تلقائيًا.</li>
        <li><b>Time Sheet:</b> طباعة كشف الحضور الشهري، أو حفظه PDF من نافذة الطباعة.</li>
        <li><b>حذف:</b> يطلب تأكيدًا قبل الحذف.</li>
      </ul>
      ${go_("trainees", "افتح قائمة المتدربين")}` },
    { icon: "clipboard", title: "التقييمات والتقرير النهائي", body: `
      <p>يتابع العمود «التقدم» عدد الأقسام التي قيّمت المتدرب من إجمالي أقسامه.</p>
      ${step(["اضغط <b>عرض التقييمات</b> لرؤية تقييم كل قسم وملاحظاته.", "اضغط <b>تصدير التقرير</b> لطباعة التقرير النهائي أو حفظه PDF (يتفعّل بعد أول تقييم)."])}
      ${go_("reports", "افتح التقييمات")}` },
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
    { icon: "users", title: "متدربو القسم", body: `
      <p>تظهر هنا قائمة المتدربين المجدولين في قسمك مع فترة تدريب كل واحد وحالة تقييمه: <span class="badge badge-red">بانتظار التقييم</span> أو <span class="badge badge-green">مُقيَّم ✓</span>.</p>
      ${go_("deptTrainees", "افتح متدربي القسم")}` },
    { icon: "pen", title: "تقييم متدرب", body: `
      ${step([
        "اضغط <b>تقييم</b> بجانب اسم المتدرب.",
        "اختر تقديرًا لكل معيار من المعايير.",
        "أضف ملاحظات إن وجدت (اختياري).",
        "اضغط <b>حفظ التقييم</b>. تقدر تعدّله لاحقًا من زر <b>تعديل التقييم</b>.",
      ])}` },
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
          <summary><span class="guide-ic">${ic("moon", 19)}</span><span class="guide-title">المظهر والجوال</span><span class="guide-chev">${ic("chevron", 18)}</span></summary>
          <div class="guide-body">
            <ul class="guide-list">
              <li>بدّل بين الوضع الفاتح والداكن من أسفل القائمة الجانبية، ويتذكر الموقع اختيارك.</li>
              <li>على الجوال افتح القائمة من زر ${ic("menu", 15)} أعلى الشاشة.</li>
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
      <div class="search-bar">
        <label class="field"><input id="d-text" placeholder="بحث بالاسم أو رقم الهوية…" aria-label="بحث بالاسم أو رقم الهوية" /></label>
      </div>
      <div id="dept-table"></div>
    </div>`;

  const draw = () => {
    const txt = $("#d-text").value.trim().toLowerCase();
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
              <td>${ev ? `<span class="badge badge-green">مُقيَّم ✓</span>` : `<span class="badge badge-red">بانتظار التقييم</span>`}</td>
              <td><button class="btn ${ev ? "btn-outline" : "btn-primary"} btn-sm" data-ev="${t.id}">${ev ? `${ic("edit", 15)} تعديل التقييم` : `${ic("pen", 15)} تقييم`}</button></td>
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
    <div class="modal-head"><h3>${ic("pen", 20)} تقييم: ${esc(t.name)}</h3>
      <button class="icon-btn" id="ev-close" aria-label="إغلاق">${ic("close")}</button></div>
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
      <button class="btn btn-primary" id="ev-save">${ic("save")} حفظ التقييم</button>
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
