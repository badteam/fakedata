// seed.js  (ESM, works with "type": "module")

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// ================== Credentials ==================
async function getServiceAccount() {
  // A) Secret واحد JSON خام
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (raw) return JSON.parse(raw);
  if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));

  // B) 3 Secrets منفصلة (زي اللي عندك)
  const pid = process.env.FIREBASE_PROJECT_ID;
  const email = process.env.FIREBASE_CLIENT_EMAIL;
  let key = process.env.FIREBASE_PRIVATE_KEY;

  if (pid && email && key) {
    if (key.includes('\\n')) key = key.replace(/\\n/g, '\n'); // fix newlines
    return {
      type: 'service_account',
      project_id: pid,
      client_email: email,
      private_key: key,
    };
  }

  // C) تشغيل محلي بملف service-account.json (اختياري)
  try {
    const sa = await import('./service-account.json', { assert: { type: 'json' } });
    return sa.default;
  } catch {
    throw new Error(
      'No credentials found. Provide FIREBASE_SERVICE_ACCOUNT (JSON) OR FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY OR add service-account.json'
    );
  }
}

const app = initializeApp({ credential: cert(await getServiceAccount()) });
const db = getFirestore(app);

// ================== Config ==================
const EMP_COUNT = Number(process.env.EMP_COUNT ?? 20);

// لو محددتش SEED_MONTH: هيستخدم آخر N يوم
const SEED_MONTH = (process.env.SEED_MONTH || '').trim(); // "YYYY-MM" أو فاضي
const SEED_ATTENDANCE = (process.env.SEED_ATTENDANCE ?? 'true').toLowerCase() !== 'false';
const DAYS_DEFAULT = Number(process.env.SEED_ATTENDANCE_DAYS ?? 7);
const PRESENT_PROB = Number(process.env.PRESENT_PROB ?? 0.8); // 80% حضور

// ================== Helpers ==================
const ROLES = ['employee', 'supervisor', 'branch_manager'];
const SHIFTS_FALLBACK = [
  { id: 'A', name: 'Shift A' },
  { id: 'B', name: 'Shift B' },
  { id: 'C', name: 'Shift C' },
];

const FIRST = ['Ahmed','Mohamed','Ali','Hassan','Omar','Youssef','Khaled','Mostafa','Hany','Karim','Laila','Nour','Hagar','Mariam','Aya','Nada','Asmaa','Sara','Dina','Reem'];
const LAST  = ['Hassan','Fathy','Said','Nasser','Mansour','Farag','Anwar','Mahmoud','Mostafa','Salem','Ali','Yehia','Kamel','Zaki','Ashraf','Ibrahim','Hamed','Fouad','Gaber','Rashed'];

const phoneHeads = ['010','011','012','015'];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function randomName() { return `${rand(FIRST)} ${rand(LAST)}`; }
function makeEmail(name, i) {
  const base = name.toLowerCase().replace(/[^a-z]/g, '') || 'user';
  return `${base}${i}@gmail.com`;
}
function randomPhone() { return `${rand(phoneHeads)}-${randInt(100,999)}-${randInt(1000,9999)}`; }
function prob(p) { return Math.random() < p; }

function randomClockOnDate(baseDate, baseHour, varianceMin) {
  const d = new Date(baseDate);
  d.setHours(baseHour, 0, 0, 0);
  const offset = randInt(-varianceMin, varianceMin);
  d.setMinutes(d.getMinutes() + offset);
  return d;
}

// days generator: يدعم شهر كامل أو آخر N يوم
function generateDates() {
  if (SEED_MONTH) {
    // توقع "YYYY-MM"
    const m = /^(\d{4})-(\d{2})$/.exec(SEED_MONTH);
    if (!m) throw new Error(`SEED_MONTH must be YYYY-MM, got "${SEED_MONTH}"`);
    const year = Number(m[1]);
    const month = Number(m[2]); // 1..12
    const first = new Date(year, month - 1, 1);
    const dates = [];
    const last = new Date(year, month, 0); // آخر يوم في الشهر
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      const copy = new Date(d);
      copy.setHours(0,0,0,0);
      dates.push(copy);
    }
    return dates;
  }
  // default: آخر N يوم
  const dates = [];
  for (let i = 0; i < DAYS_DEFAULT; i++) {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() - i);
    dates.push(d);
  }
  return dates;
}

// ================== Load branches & shifts ==================
async function loadBranches() {
  const snap = await db.collection('branches').get();
  const list = snap.docs.map((d) => ({ id: d.id, name: String(d.data().name ?? '') || d.id }));
  if (list.length === 0) {
    const ref = db.collection('branches').doc('default-branch');
    await ref.set(
      { name: 'Main Branch', code: '1', createdAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return [{ id: ref.id, name: 'Main Branch' }];
  }
  return list;
}

async function loadShifts() {
  const snap = await db.collection('shifts').get();
  const list = snap.docs.map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }));
  return list.length ? list : SHIFTS_FALLBACK;
}

// ================== Build user doc ==================
function buildUserDoc(i, branch, shift) {
  const code = `EMP-${String(i).padStart(3, '0')}`;
  const name = randomName();
  const now = FieldValue.serverTimestamp();

  const statusLower = 'approved';
  const statusLabel = 'Approved';

  const salaryBase = randInt(600, 1200);
  const overtimeRate = 60;

  return {
    // شكل الصور اللي عندك:
    branchId: branch.id,
    branchName: branch.name,
    code,
    createdAt: now,
    email: makeEmail(name, i),
    name,
    phone: randomPhone(),
    role: rand(ROLES),
    shiftId: shift.id,
    status: statusLower,   // للفلترة في UI
    statusLabel,           // للعرض فقط
    updatedAt: now,

    // توافق مع كود الأدمن:
    fullName: name,
    primaryBranchId: branch.id,
    assignedShiftId: shift.id,
    shiftName: shift.name,
    allowAnyBranch: false,

    // رواتب مختصرة:
    salaryBase,
    allowances: 0,
    deductions: [{ name: 'absense', amount: 0 }],
    overtimeRate,
  };
}

// ================== Attendance for one user ==================
async function seedAttendanceForUser(user, dates) {
  const batch = db.batch();
  let count = 0;

  for (const base of dates) {
    const key = dayKey(base);

    if (prob(PRESENT_PROB)) {
      // حاضر: IN + OUT
      const inAt = randomClockOnDate(base, 9, 20);
      const outAt = randomClockOnDate(base, 17, 30);

      const inRef = db.collection('attendance').doc(`${user.code || user.id}_${key}_in`);
      const outRef = db.collection('attendance').doc(`${user.code || user.id}_${key}_out`);

      batch.set(
        inRef,
        {
          userId: user.code || user.id,
          userName: user.name || user.fullName || '',
          branchId: user.branchId,
          branchName: user.branchName,
          shiftId: user.shiftId,
          localDay: key,
          type: 'in',
          at: Timestamp.fromDate(inAt),
          lat: 31.2523,
          lng: 29.9727,
          distance: randInt(5, 80),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      batch.set(
        outRef,
        {
          userId: user.code || user.id,
          userName: user.name || user.fullName || '',
          branchId: user.branchId,
          branchName: user.branchName,
          shiftId: user.shiftId,
          localDay: key,
          type: 'out',
          at: Timestamp.fromDate(outAt),
          lat: 31.2523,
          lng: 29.9727,
          distance: randInt(5, 80),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      count += 2;
    } else {
      // غياب: مستند واحد type=absent
      const absRef = db.collection('attendance').doc(`${user.code || user.id}_${key}_absent`);
      const nineAM = new Date(base);
      nineAM.setHours(9, 0, 0, 0);

      batch.set(
        absRef,
        {
          userId: user.code || user.id,
          userName: user.name || user.fullName || '',
          branchId: user.branchId,
          branchName: user.branchName,
          shiftId: user.shiftId,
          localDay: key,
          type: 'absent',
          at: Timestamp.fromDate(nineAM),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      count += 1;
    }
  }

  await batch.commit();
  return count;
}

// ================== Main ==================
(async function main() {
  console.log('🚀 Seeding start (Node', process.version, ')');
  console.log('EMP_COUNT:', EMP_COUNT, '| SEED_MONTH:', SEED_MONTH || '(last-N-days)');

  const branches = await loadBranches();
  const shifts = await loadShifts();
  const dates = generateDates();

  console.log(`Branches: ${branches.length}, Shifts: ${shifts.length}, Days to seed: ${dates.length}`);

  const users = [];

  for (let i = 1; i <= EMP_COUNT; i++) {
    const code = `EMP-${String(i).padStart(3, '0')}`;
    const ref = db.collection('users').doc(code);
    const snap = await ref.get();

    const br = rand(branches);
    const sh = rand(shifts);

    const baseDoc = buildUserDoc(i, br, sh);

    const payload = snap.exists
      ? {
          // تطبيع الموجود + ضمان مفاتيح التوافق
          ...baseDoc,
          ...(snap.data() || {}),
          code,
          status: 'approved',
          statusLabel: 'Approved',
          branchId: (snap.data() || {}).branchId ?? br.id,
          branchName: (snap.data() || {}).branchName ?? br.name,
          shiftId: (snap.data() || {}).shiftId ?? sh.id,
          shiftName: (snap.data() || {}).shiftName ?? sh.name,
          fullName:
            (snap.data() || {}).fullName ??
            (snap.data() || {}).name ??
            baseDoc.name,
          name:
            (snap.data() || {}).name ??
            (snap.data() || {}).fullName ??
            baseDoc.name,
          primaryBranchId:
            (snap.data() || {}).primaryBranchId ??
            (snap.data() || {}).branchId ??
            br.id,
          assignedShiftId:
            (snap.data() || {}).assignedShiftId ??
            (snap.data() || {}).shiftId ??
            sh.id,
          updatedAt: FieldValue.serverTimestamp(),
        }
      : baseDoc;

    await ref.set(payload, { merge: true });
    users.push({ id: code, ...payload });
  }

  console.log(`✅ Users ready: ${users.length}`);

  if (SEED_ATTENDANCE) {
    let total = 0;
    for (const u of users) {
      total += await seedAttendanceForUser(u, dates);
    }
    console.log(`✅ Attendance inserted: ${total} docs (${dates.length} day(s) × ${users.length} user(s), p=${PRESENT_PROB}).`);
  } else {
    console.log('ℹ️ Skipped attendance seeding (SEED_ATTENDANCE=false).');
  }

  console.log('🎉 Done.');
  process.exit(0);
})().catch((e) => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
