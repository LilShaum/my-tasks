// @ts-nocheck
/**
 * restore.mjs — losing the phone and getting everything back.
 *
 * The one path where a bug is unrecoverable. Everything else in Kittycal can
 * be re-entered; a backup that does not restore is the whole promise failing
 * at the only moment it is ever tested, on a day the old phone is already
 * gone.
 *
 * The unit tests cover buildExport and parseImport round-tripping in memory.
 * This drives the real thing: a browser with a real history exports a real
 * file through the real button, a second clean browser profile installs the
 * app from scratch, walks setup, imports that file, and is then compared
 * field by field against the original.
 *
 *     python3 -m http.server 8099 &
 *     node test/restore.mjs http://127.0.0.1:8099
 *
 * It found `birthYear` being silently discarded — which turned out not to be
 * an import bug at all, but `normalizeSettings` destroying it on every app
 * start. Nothing short of an end-to-end restore would have shown it.
 *
 * Exits non-zero on any failure.
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { chromium } = pw;
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kittycal-restore-'));
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

let fails = 0;
const check = (ok, what, detail='') => {
  if (!ok) { fails++; console.error(`  FAIL  ${what}${detail?` — ${detail}`:''}`); }
  else console.log(`  ok    ${what}`);
};

/* ── The old phone: build a rich history, then export a real file. ─────── */
const c1 = await b.newContext({ viewport:{width:430,height:932}, deviceScaleFactor:2, acceptDownloads:true });
const p1 = await c1.newPage();
p1.on('pageerror', e => { fails++; console.error('  FAIL  page error: '+e.message); });
p1.on('dialog', async d => { fails++; console.error('  FAIL  native dialog'); await d.dismiss(); });
await p1.goto(BASE, { waitUntil:'networkidle' });
await p1.evaluate(async () => {
  const db = await new Promise((res,rej)=>{const r=indexedDB.open('kittycal',1);
    r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('logs',{keyPath:'date'});
      d.createObjectStore('meta',{keyPath:'key'});d.createObjectStore('blobs',{keyPath:'id'});};
    r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const pad=n=>String(n).padStart(2,'0');
  const shift=n=>{const d=new Date();d.setDate(d.getDate()+n);
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
  const blank=(date)=>({date,flow:'none',symptoms:[],moods:[],discharge:[],activity:[],
    other:[],sex:[],drive:null,custom:[],bbt:null,weight:null,water:0,sleep:null,steps:null,
    pillTaken:false,testPregnancy:null,testOvulation:null,notes:'',checkedIn:true,updated:Date.now()});
  const days=[];
  await new Promise(res=>{const tx=db.transaction(['meta','logs'],'readwrite');
    for(let cy=6;cy>=0;cy--){const s=-6-(cy*29);for(let i=0;i<5;i++)days.push(shift(s+i));}
    for(let back=200;back>=1;back--){const k=shift(-back); const l=blank(k);
      if(days.includes(k)) l.flow='heavy';
      l.moods=[['happy','irritable'][back%2]];
      if(back%3===0) l.symptoms=['cramps'];
      if(back%7===0) l.custom=['PMS rage'];
      if(back%5===0){ l.bbt=36.55; l.weight=61.25; l.water=750; l.sleep=7.5; }
      if(back%11===0) l.notes='felt rough — "quotes" & <brackets> ünïcode 🌸';
      tx.objectStore('logs').put(l);}
    tx.objectStore('meta').put({key:'settings',value:{theme:'kuromi',onboarded:true,
      disclaimerAck:true,avgCycleLength:29,avgPeriodLength:5,name:'Sam',birthYear:1998,
      colorMode:'dark',unitTemp:'F',unitWeight:'lb',firstDayOfWeek:0,lutealLength:13,
      birthControl:'iud-copper',customSymptoms:['PMS rage'],recentChips:['cramps','happy'],
      lastBackup:'',lastBackupAt:0,checkinSkipped:shift(0)}});
    tx.objectStore('meta').put({key:'periodDays',value:days});tx.oncomplete=res;});
});
await p1.reload({ waitUntil:'networkidle' });
await p1.waitForTimeout(1700);
if (await p1.locator('.checkin-step').count()) { await p1.locator('.sheet [aria-label="Close"]').first().click(); await p1.waitForTimeout(400); }

const before = await p1.evaluate(async () => {
  const db = await new Promise((r2)=>{const r=indexedDB.open('kittycal',1);r.onsuccess=()=>r2(r.result);});
  const logs = await new Promise((res)=>{const tx=db.transaction(['logs'],'readonly');
    const g=tx.objectStore('logs').getAll();g.onsuccess=()=>res(g.result);});
  const meta = await new Promise((res)=>{const tx=db.transaction(['meta'],'readonly');
    const g=tx.objectStore('meta').getAll();g.onsuccess=()=>res(g.result);});
  const settings = meta.find(m=>m.key==='settings').value;
  const periodDays = meta.find(m=>m.key==='periodDays').value;
  return { logCount: logs.length, periodCount: periodDays.length, settings,
           sample: logs.find(l=>l.notes), byDate: Object.fromEntries(logs.map(l=>[l.date,l])) };
});
console.log(`old phone: ${before.logCount} logs, ${before.periodCount} period days`);

await p1.locator('[data-tab="settings"]').click(); await p1.waitForTimeout(800);
const dl = p1.waitForEvent('download', { timeout: 10000 });
await p1.locator('.row').filter({ hasText:'Export everything' }).first().click();
const file = await dl;
const saved = `${TMP}/backup.json`;
await file.saveAs(saved);
const raw = fs.readFileSync(saved, 'utf8');
check(raw.length > 1000, 'the export is a real file', `${raw.length} bytes`);
await c1.close();

/* ── The new phone: a clean profile, import that exact file. ──────────── */
const c2 = await b.newContext({ viewport:{width:430,height:932}, deviceScaleFactor:2 });
const p2 = await c2.newPage();
p2.on('pageerror', e => { fails++; console.error('  FAIL  page error: '+e.message); });
p2.on('dialog', async d => { fails++; console.error('  FAIL  native dialog'); await d.dismiss(); });
await p2.goto(BASE, { waitUntil:'networkidle' });
await p2.waitForTimeout(1400);
check(await p2.locator('#onboarding-root:not([hidden])').count() === 1,
  'the new phone starts at onboarding, with nothing');

/*
  Walk setup the way she would on a new phone, then restore over the top. This
  is the realistic order: the app will not show Settings until it is onboarded,
  so "install, set up, import my backup" is the only path there is.
*/
for (let i = 0; i < 12; i += 1) {
  const onb = p2.locator('#onboarding-root:not([hidden])');
  if (!await onb.count()) break;
  const next = onb.locator('button:visible')
    .filter({ hasText: /Next|Continue|Start|Finish|Done|Got it|Agree/i }).last();
  if (await next.count()) await next.click();
  else await onb.locator('button:visible').first().click();
  await p2.waitForTimeout(450);
}
await p2.waitForTimeout(900);
if (await p2.locator('.checkin-step').count()) {
  await p2.locator('.sheet [aria-label="Close"]').first().click(); await p2.waitForTimeout(400);
}
check(await p2.locator('#app-root:not([hidden])').count() === 1, 'setup completes');

await p2.locator('[data-tab="settings"]').click();
await p2.waitForTimeout(900);
const inputs = await p2.locator('input[type=file]').count();
check(inputs > 0, 'there is a file input to import through', `${inputs} found`);
await p2.locator('input[type=file]').first().setInputFiles(saved);
await p2.waitForTimeout(900);
const sheetText = await p2.locator('.sheet').innerText().catch(()=>'(none)');
check(/Replace everything/.test(sheetText), 'it asks before replacing', sheetText.slice(0,80));
await p2.locator('.sheet .btn-lg').click();
await p2.waitForTimeout(1600);

const after = await p2.evaluate(async () => {
  const db = await new Promise((r2)=>{const r=indexedDB.open('kittycal',1);r.onsuccess=()=>r2(r.result);});
  const logs = await new Promise((res)=>{const tx=db.transaction(['logs'],'readonly');
    const g=tx.objectStore('logs').getAll();g.onsuccess=()=>res(g.result);});
  const meta = await new Promise((res)=>{const tx=db.transaction(['meta'],'readonly');
    const g=tx.objectStore('meta').getAll();g.onsuccess=()=>res(g.result);});
  return { logCount: logs.length,
           periodCount: (meta.find(m=>m.key==='periodDays')?.value ?? []).length,
           settings: meta.find(m=>m.key==='settings')?.value,
           byDate: Object.fromEntries(logs.map(l=>[l.date,l])) };
});

check(after.logCount === before.logCount, 'every logged day came back',
  `${before.logCount} -> ${after.logCount}`);
check(after.periodCount === before.periodCount, 'every period day came back',
  `${before.periodCount} -> ${after.periodCount}`);

for (const k of ['theme','colorMode','unitTemp','unitWeight','firstDayOfWeek',
                 'lutealLength','birthControl','name','birthYear','avgCycleLength']) {
  check(String(after.settings?.[k]) === String(before.settings[k]), `setting "${k}" survived`,
    `${before.settings[k]} -> ${after.settings?.[k]}`);
}
check(JSON.stringify(after.settings?.customSymptoms) === JSON.stringify(before.settings.customSymptoms),
  'her own symptom names survived');

// Field-by-field on a day carrying every kind of value.
const d = before.sample.date;
const a = after.byDate[d], o = before.byDate[d];
check(!!a, 'the awkward day exists after import', d);
if (a) {
  for (const f of ['flow','bbt','weight','water','sleep','notes','checkedIn']) {
    check(JSON.stringify(a[f]) === JSON.stringify(o[f]), `  ${f} identical`,
      `${JSON.stringify(o[f])} -> ${JSON.stringify(a[f])}`);
  }
  for (const f of ['symptoms','moods','custom']) {
    check(JSON.stringify(a[f]) === JSON.stringify(o[f]), `  ${f} identical`);
  }
}

// And the app is actually usable afterwards.
await p2.reload({ waitUntil:'networkidle' });
await p2.waitForTimeout(1600);
if (await p2.locator('.checkin-step').count()) { await p2.locator('.sheet [aria-label="Close"]').first().click(); await p2.waitForTimeout(400); }
const today = await p2.locator('#view-today').innerText();
check(!/Nothing logged yet/.test(today), 'Today is working, not an empty state');
check(/Day \d+|DAY \d+/.test(today), 'the cycle is being tracked again');

console.log(fails ? `\n${fails} FAILING` : '\nrestore: everything came back');
await c2.close(); await b.close();
process.exit(fails ? 1 : 0);
