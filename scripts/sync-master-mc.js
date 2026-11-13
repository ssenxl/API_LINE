/**
 * ดึง Master MC จากไฟล์ของโปรเจกต์ Knit Plan มาเก็บในฐานข้อมูล ให้หนังสือแสดงในบท Machine
 *
 *   npm run sync:mc                  ดึงแล้วบันทึก
 *   npm run sync:mc -- --dry         ดูว่าจะได้อะไร ไม่บันทึก
 *   npm run sync:mc -- "C:\path\Master_MC.xlsx"   ระบุไฟล์เอง
 *
 * เก็บในฐานข้อมูล ไม่เก็บเป็นไฟล์ใน repo: ข้อมูลเครื่องจักรจะได้ไม่ขึ้น GitHub
 * และอัปเดตได้โดยไม่ต้อง deploy ใหม่ เปิดหนังสือครั้งถัดไปก็เห็นข้อมูลชุดใหม่เลย
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const file = args.find((arg) => !arg.startsWith('--'));

const reader = fileURLToPath(new URL('./read-master-mc.py', import.meta.url));
const python = process.env.PYTHON || 'python';
const read = spawnSync(python, [reader, ...(file ? [file] : [])], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
if (read.error) {
  console.error(`[sync:mc] เรียก ${python} ไม่ได้: ${read.error.message}`);
  process.exit(1);
}
if (read.status !== 0) {
  console.error(`[sync:mc] อ่านไฟล์ไม่สำเร็จ:\n${read.stderr.trim()}`);
  process.exit(1);
}

const master = JSON.parse(read.stdout);
if (!Array.isArray(master.rows) || master.rows.length === 0) {
  console.error('[sync:mc] ไฟล์ไม่มีแถวข้อมูลเลย ไม่บันทึก ข้อมูลชุดเดิมในฐานข้อมูลยังอยู่');
  process.exit(1);
}
master.syncedAt = new Date().toISOString();

const machines = master.rows.reduce((sum, row) => sum + (row.total ?? 0), 0);
const summary = `${master.rows.length} แถว ${machines} เครื่อง จาก ${master.file} (ชีต ${master.sheet})`;

if (dry) {
  console.log(`[sync:mc] ทดลองอ่าน: ${summary}`);
  console.log(master.rows.slice(0, 3));
  process.exit(0);
}

// โหลดหลังอ่านไฟล์เสร็จ เพราะ config.js จะหยุดโปรแกรมถ้า env ไม่ครบ
const { MASTER_MC_KEY } = await import('../src/master-mc.js');
const kb = await import('../src/knowledge.js');

// งานนี้ตั้งเวลารันทุกวัน วันที่ข้อมูลเหมือนเดิมจึงไม่จดลงประวัติของหน้าผู้ดูแล ไม่งั้นประวัติจะมีแต่เรื่องนี้
// วันที่เปลี่ยน จดไว้ว่าแถวไหนเปลี่ยนจากอะไรเป็นอะไร
const before = await kb.getSetting(MASTER_MC_KEY);
const changes = diff(before?.rows ?? [], master.rows);
await kb.saveSetting(MASTER_MC_KEY, master);
if (!before) {
  await kb.logAdmin('อัปเดต Master MC', `ดึงครั้งแรก: ${summary}`);
} else if (changes.length) {
  const shown = changes.slice(0, 12).join(' · ');
  await kb.logAdmin('อัปเดต Master MC', `${shown}${changes.length > 12 ? ` · และอีก ${changes.length - 12} จุด` : ''}`);
}
console.log(`[sync:mc] บันทึกแล้ว: ${summary}`);
console.log(changes.length ? `[sync:mc] เปลี่ยน ${changes.length} จุด:\n  ${changes.join('\n  ')}` : '[sync:mc] ข้อมูลเหมือนครั้งก่อน');
process.exit(0);

/** เทียบข้อมูลสองชุดทีละแถว (ชื่อเครื่อง + Guage) คืนรายการสิ่งที่เปลี่ยนเป็นข้อความ */
function diff(oldRows, newRows) {
  const LABELS = { total: 'จำนวนเครื่อง', hours: 'ชม./วัน', days: 'วัน/สัปดาห์', factory: 'โรงงาน', type: 'ประเภท', cat: 'MC_CAT', group: 'Group', subgroup: 'SUBGroup' };
  const name = (row) => `${row.mc} ${row.gauge}`;
  const show = (value) => (value === null || value === '' ? '–' : value);
  const old = new Map(oldRows.map((row) => [name(row), row]));
  const found = [];
  for (const row of newRows) {
    const was = old.get(name(row));
    old.delete(name(row));
    if (!was) {
      found.push(`เพิ่ม ${name(row)} (${show(row.total)} เครื่อง)`);
      continue;
    }
    for (const [key, label] of Object.entries(LABELS)) {
      if (was[key] !== row[key]) found.push(`${name(row)} ${label} ${show(was[key])} → ${show(row[key])}`);
    }
  }
  for (const gone of old.keys()) found.push(`ลบ ${gone}`);
  return found;
}
