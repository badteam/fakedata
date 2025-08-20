import admin from "firebase-admin";
import { faker } from "@faker-js/faker";

// ===== 1) Firebase Admin init من Secrets =====
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const db = admin.firestore();

// ===== 2) إعدادات =====
const EMP_COUNT = parseInt(process.env.EMP_COUNT || "20", 10);
const SEED_MONTH = process.env.SEED_MONTH || "2025-08"; // YYYY-MM
const WEEKENDS = new Set([5, 6]); // الجمعة=5، السبت=6

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function toLocalDay(y, m, d){ return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function rand(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

// ===== 3) Seed فروع لو مش موجوده =====
async function ensureBranches(){
  const snap = await db.collection("branches").limit(1).get();
  if (!snap.empty) {
    const all = await db.collection("branches").get();
    return all.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  const branches = [
    {
      name: "alex test",
      code: "2",
      address: "alex",
      geo: { lat: 31.2523, lng: 29.9725 },
      radiusMeters: 150,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "cairo hq",
      code: "1",
      address: "cairo",
      geo: { lat: 30.0444, lng: 31.2357 },
      radiusMeters: 200,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];
  const batch = db.batch();
  const created = [];
  for (const b of branches){
    const ref = db.collection("branches").doc();
    batch.set(ref, b);
    created.push({ id: ref.id, ...b });
  }
  await batch.commit();
  return created;
}

// ===== 4) أنشئ/حدّث موظفين =====
async function seedUsers(branches){
  const users = [];
  const batch = db.batch();
  for (let i=1; i<=EMP_COUNT; i++){
    const name = faker.person.fullName();
    const b = pick(branches);
    const docId = `EMP-${String(i).padStart(3,"0")}`;
    const ref = db.collection("users").doc(docId);
    const user = {
      code: docId,
      name,
      email: faker.internet.email().toLowerCase(),
      phone: faker.phone.number("+20##########"),
      branchId: b.id,
      branchName: b.name,
      shiftId: pick(["A","B","C"]),
      role: pick(["employee","supervisor","manager"]),
      status: pick(["active","on_leave","suspended"]),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    users.push({ id: docId, ...user });
    batch.set(ref, user, { merge: true });
  }
  await batch.commit();
  return users;
}

// ===== 5) ولّد Attendance بنفس الـschema =====
async function seedAttendance(users, branches){
  const [yy, mm] = SEED_MONTH.split("-").map(n=>parseInt(n,10));
  const total = daysInMonth(yy, mm);

  for (const u of users){
    for (let d=1; d<=total; d++){
      const jsDate = new Date(yy, mm-1, d);
      const dow = jsDate.getDay(); // 0..6
      const isWeekend = WEEKENDS.has(dow);
      const localDay = toLocalDay(yy, mm, d);
      const branch = branches.find(b => b.id === u.branchId) || pick(branches);

      const pPresent = isWeekend ? 0.2 : 0.7;
      const pAbsent  = isWeekend ? 0.6 : 0.15;
      const roll = Math.random();

      const baseFields = {
        userId: u.id,
        branchId: branch.id,
        branchName: branch.name,
        localDay,
      };

      if (roll < pPresent) {
        const inDate  = new Date(yy, mm-1, d, rand(8,10), rand(0,59));
        const outDate = new Date(yy, mm-1, d, rand(16,19), rand(0,59));
        await db.collection("attendance").doc(`${u.id}_${localDay}_in`).set({
          ...baseFields, type: "in", at: inDate
        });
        await db.collection("attendance").doc(`${u.id}_${localDay}_out`).set({
          ...baseFields, type: "out", at: outDate
        });
      } else if (roll < pPresent + pAbsent) {
        await db.collection("attendance").doc(`${u.id}_${localDay}_absent`).set({
          ...baseFields, type: "absent"
        });
      } else {
        const onlyIn = Math.random() < 0.5;
        if (onlyIn){
          const inDate = new Date(yy, mm-1, d, rand(8,10), rand(0,59));
          await db.collection("attendance").doc(`${u.id}_${localDay}_in`).set({
            ...baseFields, type: "in", at: inDate
          });
        } else {
          const outDate = new Date(yy, mm-1, d, rand(16,19), rand(0,59));
          await db.collection("attendance").doc(`${u.id}_${localDay}_out`).set({
            ...baseFields, type: "out", at: outDate
          });
        }
      }
    }
  }
}

async function run(){
  const branches = await ensureBranches();
  const users = await seedUsers(branches);
  await seedAttendance(users, branches);
  console.log("✅ Seed finished");
}
run().catch(e => { console.error(e); process.exit(1); });
