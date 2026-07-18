// ═══════════════════════════════════════════════════════════════
//  إعداد Firebase — عدّل هذا الملف فقط
//  Firebase configuration — edit this file only
//
//  من لوحة Firebase Console:
//  Project settings → General → Your apps → Web app → SDK setup and configuration
//  انسخ كائن firebaseConfig والصقه مكان القيم أدناه.
// ═══════════════════════════════════════════════════════════════

export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID",
};

// يصبح التطبيق جاهزًا تلقائيًا بمجرد استبدال القيم أعلاه بقيم مشروعك.
export const isConfigured = !firebaseConfig.apiKey.startsWith("PASTE_");
