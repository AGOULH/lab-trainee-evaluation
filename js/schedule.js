// ═══════════════════════════════════════════════════════════════
//  دوال التواريخ وتوليد الجدول التدريبي (وحدة نقية بدون DOM)
// ═══════════════════════════════════════════════════════════════

export const DAY_MS = 86400000;

export const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
export const isWorkday = (d) => d.getDay() >= 0 && d.getDay() <= 4; // الأحد(0) إلى الخميس(4)

// توزيع مدة التدريب بالتساوي على الأقسام المختارة — فترات متتالية من تاريخ إلى تاريخ
export function generateSchedule(startISO, months, deptIds) {
  const start = parseISO(startISO);
  const end = addMonths(start, months); // نهاية حصرية
  const totalDays = Math.round((end - start) / DAY_MS);
  const n = deptIds.length;
  const base = Math.floor(totalDays / n), rem = totalDays % n;
  const out = [];
  let cursor = new Date(start);
  deptIds.forEach((dept, i) => {
    const len = base + (i < rem ? 1 : 0);
    out.push({ dept, from: toISO(cursor), to: toISO(addDays(cursor, len - 1)), days: len });
    cursor = addDays(cursor, len);
  });
  return out;
}

// أيام العمل (أحد–خميس) لشهر معيّن ضمن فترة التدريب — لورقة الـ Time Sheet
export function workdaysInMonth(monthStart, periodStart, periodEnd) {
  const out = [];
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  for (let d = new Date(monthStart); d <= monthEnd; d = addDays(d, 1)) {
    if (d < periodStart || d > periodEnd || !isWorkday(d)) continue;
    out.push(new Date(d));
  }
  return out;
}
