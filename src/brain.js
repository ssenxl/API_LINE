import { askJSON } from './ai.js';

/**
 * คำสั่ง (prompt) ทั้งหมดที่ใช้คุยกับ AI อยู่ในไฟล์นี้
 * ถ้าอยากปรับพฤติกรรมของบอท เช่นให้ถามกลับบ่อยขึ้น หรือเขียนหนังสือสไตล์อื่น แก้ที่นี่
 *
 * AI อาจตอบมาไม่ครบหรือผิดรูปแบบ ทุกฟังก์ชันจึงกรองผลลัพธ์ก่อนส่งออกไปเสมอ
 */

const WRITING_RULES = `## วิธีเขียนกฎ
- แยกเป็นข้อ ๆ หนึ่งข้อต่อหนึ่งเรื่อง
- summary ต้องเป็นภาษาคนธรรมดา อ่านเข้าใจได้เองโดยไม่ต้องเห็นแชท บอกให้ครบว่ากรณีไหน ต้องทำอะไร และเพราะอะไร (ถ้าผู้ใช้บอกเหตุผลมา)
- ตัวเลข หน่วย ชื่อเฉพาะ เงื่อนไข และข้อยกเว้น ต้องตรงตามที่ผู้ใช้บอก ห้ามเดาหรือเติมเอง
- title คือชื่อกฎสั้น ๆ ไม่เกินหนึ่งบรรทัด
- topic คือชื่อบทในหนังสือ ใช้ชื่อบทที่มีอยู่แล้วถ้าเข้ากันได้ ตั้งใหม่เฉพาะเมื่อไม่เข้ากับบทไหนเลย ชื่อบทควรสั้นและกว้างพอให้รวมหลายกฎได้`;

/**
 * ใส่ค่าลงช่อง {ชื่อ} ใน prompt รอบเดียว
 * ไม่ใช้ String.replace ตรง ๆ เพราะมันตีความ $1 $& ในข้อความผู้ใช้เป็นคำสั่งพิเศษ
 */
function fill(template, values) {
  return template.replace(/\{([A-Z]+)\}/g, (match, key) => values[key] ?? match);
}

function formatRules(rules) {
  if (rules.length === 0) return '(ยังไม่มี)';
  return rules
    .map((r) => `#${r.id} [${r.topic}] ${r.title} — ${r.summary} (สอนโดย ${r.author})`)
    .join('\n');
}

function listTopics(rules) {
  const topics = [...new Set(rules.map((r) => r.topic))];
  return topics.length ? topics.join(', ') : '(ยังไม่มีบทไหน)';
}

// ---------- ตัวกรองผลลัพธ์จาก AI ----------

const text = (value, max = 4000) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const list = (value) => (Array.isArray(value) ? value : []);
const ruleId = (value) => (Number.isInteger(value) && value > 0 ? value : null);

function cleanRule(raw) {
  const rule = {
    topic: text(raw?.topic, 100) || 'เรื่องทั่วไป',
    title: text(raw?.title, 200),
    summary: text(raw?.summary),
  };
  return rule.title && rule.summary ? rule : null;
}

// ---------- 1. อ่านข้อความผู้ใช้ ----------

const ANALYZE_PROMPT = `คุณคือ "บรรณารักษ์ความรู้" ของทีม คอยฟังสิ่งที่คนในทีมเล่าผ่าน LINE แล้วจดเป็นกฎ/logic การทำงาน เพื่อทำเป็นหนังสือให้คนรุ่นถัดไปอ่านเข้าใจ

อ่านข้อความล่าสุดของผู้ใช้ (ประกอบกับบทสนทนาก่อนหน้า) แล้วตัดสินว่าเป็นแบบไหน
- "teach"    ผู้ใช้บอกกฎ เงื่อนไข ขั้นตอน สูตร ข้อยกเว้น หรือวิธีตัดสินใจที่ควรจดไว้
- "clarify"  ผู้ใช้กำลังสอน แต่ข้อมูลยังไม่ครบหรือกำกวมจนสรุปเป็นกฎที่ถูกต้องไม่ได้ ต้องถามกลับก่อน
- "question" ผู้ใช้ถามเรื่องที่อาจอยู่ในกฎที่จดไว้
- "chat"     ทักทาย ขอบคุณ หรือคุยเรื่องอื่น

## กฎที่จดไว้แล้วตอนนี้
{RULES}

## ชื่อบทที่มีอยู่แล้ว
{TOPICS}

${WRITING_RULES}

## เทียบกับของเดิม (สำคัญที่สุด)
- พูดซ้ำกับกฎเดิมโดยไม่มีอะไรใหม่ → ใส่ id ใน duplicates ไม่ต้องสร้างกฎใหม่
- เพิ่มรายละเอียดให้กฎเดิมโดยไม่ขัดกัน → ใส่ใน updates พร้อม summary ฉบับใหม่ที่รวมของเดิมกับของใหม่ไว้ครบ และ reason ว่าเพิ่มอะไร
- ขัดแย้ง คือสถานการณ์เดียวกันแต่ได้ผลลัพธ์หรือการกระทำต่างกัน → ใส่ใน conflicts พร้อม explanation ว่าขัดกันตรงไหน
  - รวมถึงกรณีที่ข้อความใหม่ขัดกันเอง หรือขัดกับที่ผู้ใช้พูดไว้ก่อนหน้าในแชท ให้ใส่ rule_id เป็น null
  - ถ้าเงื่อนไขต่างกันชัดเจน (คนละกรณี) ไม่ถือว่าขัดแย้ง
  - เมื่อมี conflicts ยังไม่ต้องตัดสินเอง ให้ใส่ rules/updates ตามที่ผู้ใช้พูดมาใหม่ไว้ แล้วใน reply ให้เล่าทั้งสองฝั่ง (ของเดิมว่าอย่างไร ใครสอน / ของใหม่ว่าอย่างไร) และถามว่าอันไหนถูก อันเก่าเลิกใช้แล้วหรือยัง หรือทั้งคู่ใช้คนละกรณี

## reply (ข้อความที่จะส่งกลับไปใน LINE)
- ภาษาไทย สุภาพ กระชับ เป็นกันเอง ไม่ใช้ markdown เพราะ LINE ไม่แสดงผล
- teach ที่ไม่มีข้อขัดแย้ง: ตอบรับสั้น ๆ ประโยคเดียว ไม่ต้องทวนกฎ เพราะระบบจะแนบรายการที่บันทึกให้เอง
- clarify: ถามให้ตรงจุดว่าขาดอะไร ครั้งละไม่เกิน 2 คำถาม
- question: ตอบจากกฎที่จดไว้เท่านั้น และระบุเลขข้อ เช่น (ข้อ #12) ถ้าไม่มีในกฎ ให้บอกตรง ๆ ว่ายังไม่มีใครสอนเรื่องนี้ ห้ามแต่งเอง

## follow_up (เฉพาะ teach ที่ไม่มีข้อขัดแย้ง)
กฎที่บันทึกได้แล้วอาจยังมีช่องโหว่ ให้ถามต่อเพื่อให้กฎครบขึ้น ไม่เกิน 2 คำถาม เป็นภาษาไทยสั้น ๆ ถามตรงจุด
- ถามเฉพาะช่องโหว่ที่เกิดจากเงื่อนไขในกฎเอง เช่น ตัวเลขที่อยู่ตรงรอยต่อพอดี (ออเดอร์ 500 กิโลพอดีใช้เครื่องไหน) กรณีที่เงื่อนไขไม่เป็นจริงต้องทำอย่างไร หรือกรณีที่กฎพูดถึงแต่ไม่ได้บอกว่าต้องทำอะไร
- ห้ามถามเรื่องทั่วไปอย่างความปลอดภัย การสอบเทียบ การแก้ปัญหา และห้ามถามซ้ำเรื่องที่ผู้ใช้ตอบไปแล้วในแชท
- ถ้ากฎครบแล้วหรือผู้ใช้บอกว่าพอแล้ว ให้เป็น []

ตอบเป็น JSON เท่านั้น ในรูปแบบนี้ (ช่องที่ไม่ใช้ให้ใส่ [] )
{"intent":"teach|clarify|question|chat","rules":[{"topic":"","title":"","summary":""}],"updates":[{"rule_id":1,"topic":"","title":"","summary":"","reason":""}],"duplicates":[1],"conflicts":[{"rule_id":1,"explanation":""}],"follow_up":[""],"reply":""}`;

export async function analyzeMessage({ text: message, history, rules }) {
  const system = fill(ANALYZE_PROMPT, { RULES: formatRules(rules), TOPICS: listTopics(rules) });
  const raw = await askJSON(system, [...history, { role: 'user', content: message }]);

  const intents = ['teach', 'clarify', 'question', 'chat'];
  return {
    intent: intents.includes(raw.intent) ? raw.intent : 'chat',
    rules: list(raw.rules).map(cleanRule).filter(Boolean),
    updates: list(raw.updates)
      .map((u) => {
        const rule = cleanRule(u);
        const id = ruleId(u?.rule_id);
        return rule && id ? { ...rule, rule_id: id, reason: text(u.reason, 500) } : null;
      })
      .filter(Boolean),
    duplicates: list(raw.duplicates).map(ruleId).filter(Boolean),
    conflicts: list(raw.conflicts)
      .map((c) => ({ rule_id: ruleId(c?.rule_id), explanation: text(c?.explanation, 1000) }))
      .filter((c) => c.explanation),
    followUp: list(raw.follow_up).map((q) => text(q, 300)).filter(Boolean).slice(0, 2),
    reply: text(raw.reply) || 'รับทราบครับ',
  };
}

// ---------- 2. ตัดสินข้อขัดแย้งจากคำตอบของผู้ใช้ ----------

const RESOLVE_PROMPT = `คุณคือ "บรรณารักษ์ความรู้" ของทีม ก่อนหน้านี้คุณพบว่าสิ่งที่ผู้ใช้สอนมาขัดแย้งกับความรู้ที่มีอยู่ และได้ถามผู้ใช้กลับไปแล้ว ตอนนี้ผู้ใช้ตอบกลับมา

## ข้อความต้นเรื่องที่ผู้ใช้สอนมา
{ORIGINAL}

## สิ่งที่ AI สรุปจากข้อความนั้น (ยังไม่ได้บันทึก)
{PROPOSED}

## กฎเดิมที่เกี่ยวข้อง
{OLD}

## ขัดกันตรงไหน
{EXPLANATION}

## คำถามที่ถามผู้ใช้ไป
{QUESTION}

อ่านคำตอบล่าสุดของผู้ใช้แล้วเลือก status
- "resolved"  ผู้ใช้ตอบชัดพอจะสรุปได้แล้ว
  - retire_rule_ids: กฎเดิมที่ต้องเลิกใช้ เลือกได้เฉพาะจาก {IDS} ถ้าของเดิมยังถูกอยู่ไม่ต้องใส่
  - add_rules: กฎฉบับสุดท้ายที่ต้องบันทึกเพิ่ม ถ้าแยกเป็นคนละกรณีให้เขียนเงื่อนไขของแต่ละข้อให้ชัด ถ้าผู้ใช้บอกว่าของเดิมถูกแล้ว ให้เป็น []
  - decision: สรุปเป็นภาษาคน 1-3 ประโยคว่าตัดสินอย่างไร เพราะอะไร ใครเป็นคนยืนยัน เพื่อให้คนที่อ่านหนังสือทีหลังเข้าใจที่มา
- "ask_again" คำตอบยังไม่ชัดพอ ให้ถามต่อให้ตรงจุด
- "cancelled" ผู้ใช้บอกว่าไม่ต้องบันทึกเรื่องนี้แล้ว
- "unrelated" ผู้ใช้พูดเรื่องอื่นที่ไม่เกี่ยวกับคำถามนี้เลย

${WRITING_RULES}

reply คือข้อความที่จะส่งกลับไปใน LINE เป็นภาษาไทย สั้น สุภาพ ไม่ใช้ markdown
ถ้า resolved ไม่ต้องทวนกฎ ระบบจะแนบรายการที่บันทึกให้เอง

ตอบเป็น JSON เท่านั้น ในรูปแบบนี้
{"status":"resolved|ask_again|cancelled|unrelated","retire_rule_ids":[1],"add_rules":[{"topic":"","title":"","summary":""}],"decision":"","reply":""}`;

export async function resolveConflict({ conflict, originalText, oldRules, text: answer, history }) {
  const proposed = conflict.proposed ?? {};
  const proposedText = [
    ...list(proposed.rules).map((r) => `- กฎใหม่ [${r.topic}] ${r.title} — ${r.summary}`),
    ...list(proposed.updates).map(
      (u) => `- แก้กฎ #${u.rule_id} เป็น: [${u.topic}] ${u.title} — ${u.summary}`,
    ),
  ].join('\n');

  const system = fill(RESOLVE_PROMPT, {
    ORIGINAL: originalText,
    PROPOSED: proposedText || '(ไม่มี)',
    OLD: formatRules(oldRules),
    EXPLANATION: conflict.explanation,
    QUESTION: conflict.question,
    IDS: conflict.rule_ids.length ? conflict.rule_ids.join(', ') : '(ไม่มี)',
  });

  const raw = await askJSON(system, [...history, { role: 'user', content: answer }]);

  const statuses = ['resolved', 'ask_again', 'cancelled', 'unrelated'];
  const allowed = new Set(conflict.rule_ids);
  return {
    status: statuses.includes(raw.status) ? raw.status : 'ask_again',
    retireIds: list(raw.retire_rule_ids).map(ruleId).filter((id) => allowed.has(id)),
    addRules: list(raw.add_rules).map(cleanRule).filter(Boolean),
    decision: text(raw.decision, 1000),
    reply: text(raw.reply) || 'รับทราบครับ',
  };
}

// ---------- 3. เรียบเรียงบทในหนังสือ ----------

// เปลี่ยนเลขนี้เมื่อแก้ CHAPTER_PROMPT เพื่อให้ทุกบทถูกเขียนใหม่ด้วยคำสั่งใหม่
export const CHAPTER_PROMPT_VERSION = 3;

const CHAPTER_PROMPT = `คุณกำลังเขียนบทหนึ่งในหนังสือความรู้ของทีม ให้คนที่เพิ่งเข้ามาใหม่อ่านแล้วเข้าใจและทำงานต่อได้ทันที

ชื่อบท: {TOPIC}

## กฎทั้งหมดในบทนี้
{RULES}

เขียนเป็นภาษาไทยที่อ่านง่าย เหมือนรุ่นพี่อธิบายให้รุ่นน้องฟัง
- ความยาวต้องพอดีกับเนื้อหา กฎข้อเดียวเขียนสั้น ๆ ก็พอ ห้ามพูดเรื่องเดิมซ้ำหลายรอบ ห้ามทำหัวข้อ "สรุป" ที่ทวนสิ่งที่เพิ่งพูดไป
- overview: บทนี้เกี่ยวกับอะไร ใช้ตอนไหน 1-3 ประโยค
- sections: เรียงตามลำดับที่คนทำงานจะเจอจริง รวมเรื่องที่เกี่ยวกันไว้ด้วยกัน ถ้ามีกฎน้อย ใช้ section เดียวก็ได้
  - body แบ่งย่อหน้าด้วยบรรทัดว่าง รายการต้องขึ้นบรรทัดใหม่ทีละข้อ นำหน้าด้วย "- "
  - ทุกครั้งที่พูดถึงกฎ ให้อ้างเลขข้อในวงเล็บ เช่น (ข้อ #12)
  - ถ้ามีเหตุผลในกฎ ให้เล่าเหตุผลด้วย เพราะช่วยให้คนอ่านจำและตัดสินใจเองได้
- gaps: ไม่เกิน 3 ข้อ เฉพาะช่องโหว่ที่เกิดจากเงื่อนไขในกฎเอง เช่น ตัวเลขที่อยู่ตรงรอยต่อพอดี (ออเดอร์ 500 กิโลพอดีใช้เครื่องไหน) หรือกรณีที่กฎพูดถึงแต่ไม่ได้บอกว่าต้องทำอะไร ห้ามใส่เรื่องทั่วไปอย่างความปลอดภัย การสอบเทียบ การแก้ปัญหา ถ้าไม่มีให้เป็น []
- ห้ามเพิ่มข้อมูล คำแนะนำ หรือคำเน้นที่ไม่มีอยู่ในกฎ เช่น "ไม่ว่าด้วยเหตุผลใด" "ควรคอยตรวจเช็ก" ถ้ากฎไม่ได้พูดไว้ คนอ่านจะเข้าใจผิดว่าเป็นกฎจริง

ตอบเป็น JSON เท่านั้น ในรูปแบบนี้
{"overview":"","sections":[{"heading":"","body":""}],"gaps":[""]}`;

export async function writeChapter(topic, rules) {
  const system = fill(CHAPTER_PROMPT, { TOPIC: topic, RULES: formatRules(rules) });
  const raw = await askJSON(system, [{ role: 'user', content: `เขียนบท "${topic}"` }]);

  return {
    overview: text(raw.overview),
    sections: list(raw.sections)
      .map((s) => ({ heading: text(s?.heading, 200), body: text(s?.body, 10_000) }))
      .filter((s) => s.body),
    gaps: list(raw.gaps).map((g) => text(g, 500)).filter(Boolean),
  };
}
