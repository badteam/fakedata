// seed.js
// --- Random users + attendance seeder (Firestore) ---
// Works on GitHub Actions or locally.
// If service account is provided via env:
//   FIREBASE_SERVICE_ACCOUNT   = raw JSON
//   or FIREBASE_SERVICE_ACCOUNT_BASE64 = base64(JSON)
// Else it will try ./service-account.json

const admin = require('firebase-admin');

// ---------- Service Account bootstrapping ----------
function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (raw) return JSON.parse(raw);
  if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  try {
    // Fallback to local file when running manually
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require('./service-account.json');
  } catch {
    throw new Error('No service account found. Provide FIREBASE_SERVICE_ACCOUNT(_BASE64) or add service-account.json');
  }
}

admin.initializeApp({
  credential: admin.credential.cert(getServiceAccount()),
});
const db = admin.firestore();

// ----------------- Config -----------------
const USERS_COUNT = 20;
const SEED_ATTENDANCE = (process.env.SEED_ATTENDANCE ?? 'true').toLowerCase() !== 'false';
const DAYS = parseInt(process.env.SEED_ATTENDANCE_DAYS ?? '7', 10); // last N days
const PRESENT_PROB = Number(process.env.PRESENT_PROB ?? '0.8');     // 80% حضور

// ----------------- Utils -----------------
const ROLES = ['employee', 'supervisor', 'branch_manager'];
const SHIFTS_FALLBACK = [{ id: 'A', name: 'Shift A' }, { id: 'B', name: 'Shift B' }, { id: 'C', name: 'Shift C' }];

const FIRST = ['Ahmed','Mohamed','Ali','Hassan','Omar','Youssef','Khaled','Mostafa','Hany','Karim','Laila','Nour','Hagar','Mariam','Aya','Nada','Asmaa','Sara','Dina','Reem'];
const LAST  = ['Hassan','Fathy','Said','Nasser','Mansour','Farag','Anwar','Mahmoud','Mostafa','Salem','Ali','Yehia','Kamel','Zaki','Ashraf','Ibrahim','Hamed','Fouad','Gaber','Rashed'];

const phoneHeads = ['010','011','012','015'];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min,max) => Math.floor(Math.random()*(max-min+1))+min;
const pad2 = (n) => String(n).padStart(2,'0');
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

function randomName() { return `${rand(FIRST)} ${rand(LAST)}`; }
function makeEmail(name, i) {
  const base = name.toLowerCase().replace(/[^a-z]/g,'') || 'user';
  return `${base}${i}@gmail.com`;
}
function randomPhone() { return `${rand(phoneHeads)}-${randInt(100,999)}-${randInt(1000,9999)}`; }
function prob(p) { return Math.random() < p; }

// Generate random check-in/out around base hour with variance minutes
function randomClock(baseHour, varianceMin) {
  const d = new Date();
  d.setHours(baseHour, 0, 0, 0);
  const offset = randInt(-varianceMin, varianceMin);
  d.setMinutes(d.getMinutes() + offset);
  return d;
}

// ----------------- Data loading -----------------
async function loadBranches() {
  const snap = await db.collection('branches').get();
  const list = snap.docs.map(d => ({ id: d.id, name: String(d.data().name ?? '') || d.id }));
  if (list.length === 0) {
    const ref = db.collection('branches').doc('default-branch');
    await ref.set({ name: 'Main Branch', code: '1', createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return [{ id: ref.id, name: 'Main Branch' }];
  }
  return list;
}

async function loadShifts() {
  const snap = await db.collection('shifts').get();
  const list = snap.docs.map(d => ({ id: d.id, name: String(d.data().name ?? d.id) }));
  return list.length ? list : SHIFTS_FALLBACK;
}

// ----------------- User doc builder -----------------
function buildUserDoc(i, branch, shift) {
  const code = `EMP-${String(i).padStart(3,'0')}`;
  const name = randomName();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const statusLower = 'approved';
  const statusLabel = 'Approved';

  // الرواتب (قيم بسيطة قابلة للتعديل لاحقًا)
  const salaryBase = randInt(600, 1200);
  const overtimeRate = 60;

  return {
    // الشكل اللي في صورك:
    branchId: branch.id,
    branchName: branch.name,
    code,
    createdAt: now,
    email: makeEmail(name, i),
    name,
    phone: randomPhone(),
    role: rand(ROLES),
    shiftId: shift.id,
    status: statusLower,     // للـ UI
    statusLabel,             // للعرض لو حبيت

    updatedAt: now,

    // مفاتيح توافق مع شاشات قديمة/جديدة:
    fullName: name,
    primaryBranchId: branch.id,
    assignedShiftId: shift.id,
    shiftName: shift.name,
    allowAnyBranch: false,

    // رواتب مختصرة:
    salaryBase,
    allowances: 0, // مجموع
    deductions: [{ name: 'absense', amount: 0 }],
    overtimeRate,
  };
}

// ----------------- Attendance seeding -----------------
async function seedAttendanceForUser(user, days) {
  const batch = db.batch();
  let count = 0;

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);

    // إبعد عن المستقبل
    if (d > new Date()) continue;

    if (prob(PRESENT_PROB)) {
      // حاضر: سجل IN و OUT
      const inAt  = randomClock(9, 20);   // 9AM ±20m
      const outAt = randomClock(17, 30);  // 5PM ±30m

      const inRef  = db.collection('attendance').doc(`${user.code || user.id || user.uid}_${key}_in`);
      const outRef = db.collection('attendance').doc(`${user.code || user.id || user.uid}_${key}_out`);

      batch.set(inRef, {
        userId: user.code || user.id,
        userName: user.name || user.fullName || '',
        branchId: user.branchId,
        branchName: user.branchName,
        shiftId: user.shiftId,
        localDay: key,
        type: 'in',
        at: admin.firestore.Timestamp.fromDate(inAt),
        lat: 31.25,
        lng: 29.97,
        distance: randInt(5, 80),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      batch.set(outRef, {
        userId: user.code || user.id,
        userName: user.name || user.fullName || '',
        branchId: user.branchId,
        branchName: user.branchName,
        shiftId: user.shiftId,
        localDay: key,
        type: 'out',
        at: admin.firestore.Timestamp.fromDate(outAt),
        lat: 31.25,
        lng: 29.97,
        distance: randInt(5, 80),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      count += 2;
    } else {
      // غياب: وثيقة واحدة type=absent (تدعمها شاشة الغياب)
      const absRef = db.collection('attendance').doc(`${user.code || user.id || user.uid}_${key}_absent`);
      batch.set(absRef, {
        userId: user.code || user.id,
        userName: user.name || user.fullName || '',
        branchId: user.branchId,
        branchName: user.branchName,
        shiftId: user.shiftId,
        localDay: key,
        type: 'absent',
        at: admin.firestore.Timestamp.fromDate(new Date(d.getTime() + 9*60*60*1000)), // 9AM of that day
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      count += 1;
    }
  }

  await batch.commit();
  return count;
}

// ----------------- Main -----------------
(async function main() {
  console.log('🚀 Seeding start...');
  const branches = await loadBranches();
  const shifts = await loadShifts();

  console.log(`Branches: ${branches.length}, Shifts: ${shifts.length}`);

  // Create/normalize EMP-001..EMP-020
  const userDocs = [];
  for (let i = 1; i <= USERS_COUNT; i++) {
    const code = `EMP-${String(i).padStart(3,'0')}`;
    const ref = db.collection('users').doc(code);
    const snap = await ref.get();

    const br = rand(branches);
    const sh = rand(shifts);

    const payload = snap.exists
      ? { // normalize old to new + ensure compatibility keys
          ...buildUserDoc(i, br, sh),
          // keep existing email/name if you want:
          ...(snap.data() || {}),
          code, // enforce correct code
          status: 'approved',
          statusLabel: 'Approved',
          branchId: (snap.data() || {}).branchId || br.id,
          branchName: (snap.data() || {}).branchName || br.name,
          shiftId: (snap.data() || {}).shiftId || sh.id,
          shiftName: (snap.data() || {}).shiftName || sh.name,
          fullName: (snap.data() || {}).fullName || (snap.data() || {}).name || buildUserDoc(i, br, sh).name,
          name: (snap.data() || {}).name || (snap.data() || {}).fullName || buildUserDoc(i, br, sh).name,
          primaryBranchId: (snap.data() || {}).primaryBranchId || ((snap.data() || {}).branchId) || br.id,
          assignedShiftId: (snap.data() || {}).assignedShiftId || ((snap.data() || {}).shiftId) || sh.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }
      : buildUserDoc(i, br, sh);

    await ref.set(payload, { merge: true });
    userDocs.push({ id: code, ...payload });
  }
  console.log(`✅ Users ready: ${userDocs.length}`);

  if (SEED_ATTENDANCE) {
    let total = 0;
    for (const u of userDocs) {
      total += await seedAttendanceForUser(u, DAYS);
    }
    console.log(`✅ Attendance inserted: ${total} docs for last ${DAYS} day(s).`);
  } else {
    console.log('ℹ️ Skipped attendance seeding (SEED_ATTENDANCE=false).');
  }

  console.log('🎉 Done.');
  process.exit(0);
})().catch((e) => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
