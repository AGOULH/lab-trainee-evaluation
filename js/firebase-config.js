// ═══════════════════════════════════════════════════════════════
//  إعداد Firebase — عدّل هذا الملف فقط
//  Firebase configuration — edit this file only
//
//  من لوحة Firebase Console:
//  Project settings → General → Your apps → Web app → SDK setup and configuration
//  انسخ كائن firebaseConfig والصقه مكان القيم أدناه.
// ═══════════════════════════════════════════════════════════════

export const firebaseConfig = {
  apiKey: "AIzaSyCnKDKrmQcjs4Q96SuqR7kvbkYY1_weBSI",
  authDomain: "lab-trainee-evaluation.firebaseapp.com",
  projectId: "lab-trainee-evaluation",
  storageBucket: "lab-trainee-evaluation.firebasestorage.app",
  messagingSenderId: "252826002833",
  appId: "1:252826002833:web:76b093fbd2736a8d906630",
};

// يصبح التطبيق جاهزًا تلقائيًا بمجرد استبدال القيم أعلاه بقيم مشروعك.
export const isConfigured = !firebaseConfig.apiKey.startsWith("PASTE_");
