import { classifyRules } from './brain.js';
import { CATEGORY_NAMES, FALLBACK_CATEGORY, matchCategory } from './categories.js';
import * as kb from './knowledge.js';

/**
 * ย้ายกฎที่ยังไม่อยู่ในหมวดหลักเข้าหมวด (ทุกสถานะ ทั้งที่ใช้อยู่และที่เลิกใช้แล้ว) พร้อมคำถามของกฎเหล่านั้น
 * เรียกทุกครั้งตอนเปิดเครื่อง ถ้าทุกข้ออยู่ในหมวดแล้วก็แค่อ่านฐานข้อมูลครั้งเดียวจบ ไม่เสียค่า AI
 *
 * ที่ต้องมีเพราะกฎที่สอนไว้ก่อนมีหมวดหลักใช้ชื่อบทที่ AI ตั้งเอง และถ้าวันหน้าเปลี่ยนชื่อหมวดใน categories.js
 * กฎในหมวดเดิมก็จะถูกจัดใหม่ด้วยวิธีเดียวกัน
 * ย้ายแค่หมวด เลขข้อ เนื้อหา และประวัติของกฎไม่เปลี่ยน ผู้ดูแลย้ายข้อที่ AI จัดผิดได้เองจากหน้า /admin
 *
 * คืนจำนวนข้อที่ย้าย ถ้าเรียก AI ไม่สำเร็จจะโยน error และยังไม่ได้ย้ายอะไร
 */
export async function recategorize() {
  const rules = await kb.rulesOutsideCategories(CATEGORY_NAMES);
  if (rules.length === 0) return 0;

  // ชื่อบทเก่าที่สะกดต่างจากชื่อหมวดนิดเดียว (เช่น "Machine") ไม่ต้องถาม AI
  const picked = new Map();
  const unsure = [];
  for (const rule of rules) {
    const name = matchCategory(rule.topic);
    if (name) picked.set(rule.id, name);
    else unsure.push(rule);
  }
  if (unsure.length) {
    for (const [id, name] of await classifyRules(unsure)) picked.set(id, name);
  }

  // ข้อที่ AI ตกหล่น และคำถามที่ไม่มีกฎให้ตามไป ใช้หมวดที่กฎส่วนใหญ่ในบทเก่าเดียวกันได้ไป
  const fallback = majorityByTopic(rules, picked);
  const moves = rules.map((r) => ({
    id: r.id,
    from: r.topic,
    to: picked.get(r.id) ?? fallback.get(r.topic) ?? FALLBACK_CATEGORY,
  }));

  const moved = await kb.moveRulesToCategories({
    moves,
    fallback,
    names: CATEGORY_NAMES,
    otherwise: FALLBACK_CATEGORY,
  });
  if (moved.length) {
    // เก็บชื่อบทเก่าไว้ในประวัติ ถ้าอยากย้อนกลับจะได้รู้ว่าแต่ละข้อเคยอยู่ไหน
    await kb.logAdmin('จัดกฎเข้าหมวดหลัก', moved.map((m) => `#${m.id} ${m.from} → ${m.to}`).join(' · '));
  }
  return moved.length;
}

function majorityByTopic(rules, picked) {
  const votes = new Map();
  for (const rule of rules) {
    const name = picked.get(rule.id);
    if (!name) continue;
    if (!votes.has(rule.topic)) votes.set(rule.topic, new Map());
    const count = votes.get(rule.topic);
    count.set(name, (count.get(name) ?? 0) + 1);
  }
  return new Map(
    [...votes].map(([topic, count]) => [topic, [...count].sort((a, b) => b[1] - a[1])[0][0]]),
  );
}
