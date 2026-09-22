import { analyzeMessage, resolveConflict } from './brain.js';
import { config } from './config.js';
import * as kb from './knowledge.js';
import { deliver, getProfile, showLoading } from './line.js';

const RESET_KEYWORDS = ['เริ่มใหม่', 'ล้างประวัติ', 'reset', 'clear'];
const MY_ID_KEYWORDS = ['ไอดีของฉัน', 'ไอดี', 'myid'];
const BOOK_KEYWORDS = ['หนังสือ', 'ขอหนังสือ', 'book'];
const CANCEL_KEYWORDS = ['ยกเลิก', 'cancel'];

const ERROR_REPLY = 'ขออภัยครับ ระบบขัดข้องชั่วคราว รบกวนลองพิมพ์ใหม่อีกครั้ง';
const NOT_TEACHER_REPLY =
  'ขอบคุณที่เล่าให้ฟังครับ แต่บัญชีนี้ยังไม่มีสิทธิ์บันทึกความรู้เข้าหนังสือ ' +
  'ถ้าต้องการสอน ให้พิมพ์ "ไอดีของฉัน" แล้วส่งรหัสที่ได้ให้ผู้ดูแลเพิ่มสิทธิ์ให้';
const WELCOME =
  'สวัสดีครับ ผมเป็นผู้ช่วยจดความรู้ของทีม\n\n' +
  '• เล่ากฎหรือวิธีทำงานให้ฟังได้เลย ผมจะสรุปเก็บไว้ ถ้าขัดกับของเดิมจะถามกลับก่อนบันทึก\n' +
  '• ถามเรื่องที่เคยมีคนสอนไว้ได้\n' +
  '• พิมพ์ "หนังสือ" เพื่อรับลิงก์อ่านความรู้ทั้งหมด\n' +
  '• พิมพ์ "เริ่มใหม่" เพื่อเริ่มคุยเรื่องใหม่';

/**
 * LINE ยิง webhook ซ้ำได้เมื่อ network มีปัญหา จึงต้องกันประมวลผลซ้ำ
 * เก็บแค่ id ล่าสุดพอ เพราะ LINE retry ภายในไม่กี่นาที
 */
const seenEvents = new Set();
const SEEN_LIMIT = 1000;

function isDuplicate(eventId) {
  if (!eventId) return false;
  if (seenEvents.has(eventId)) return true;

  seenEvents.add(eventId);
  if (seenEvents.size > SEEN_LIMIT) {
    // Set รักษาลำดับที่ใส่ ตัดตัวเก่าสุดออกไปครึ่งหนึ่ง
    const oldest = [...seenEvents].slice(0, SEEN_LIMIT / 2);
    for (const id of oldest) seenEvents.delete(id);
  }
  return false;
}

/**
 * ทำงานของผู้ใช้คนเดียวกันทีละข้อความตามลำดับ
 * ถ้าพิมพ์รัว ๆ สองข้อความ อันที่สองต้องเห็นกฎที่อันแรกเพิ่งบันทึก ไม่งั้นจะจับข้อขัดแย้งพลาด
 */
const queues = new Map();

function inOrder(userId, task) {
  const previous = queues.get(userId) ?? Promise.resolve();
  const current = previous.then(task);
  const settled = current.catch(() => {});
  queues.set(userId, settled);
  settled.then(() => {
    if (queues.get(userId) === settled) queues.delete(userId);
  });
  return current;
}

function bookLink() {
  if (config.book.slug) return `${config.publicUrl}/${config.book.slug}`;
  const key = config.book.key ? `?key=${encodeURIComponent(config.book.key)}` : '';
  return `${config.publicUrl}/book${key}`;
}

function describeSaved(saved) {
  return saved
    .map((r) => {
      const label = r.replaces ? `✏️ ปรับข้อ #${r.replaces} เป็นข้อ #${r.id}` : `📝 บันทึกข้อ #${r.id}`;
      return `${label} · ${r.topic}\n${r.title}\n${r.summary}`;
    })
    .join('\n\n');
}

export async function handleEvent(event) {
  if (isDuplicate(event.webhookEventId)) {
    console.log('[handler] ข้าม event ซ้ำ', event.webhookEventId);
    return;
  }

  if (event.type === 'follow') {
    await deliver({ replyToken: event.replyToken, userId: event.source?.userId, text: WELCOME });
    return;
  }

  // รองรับเฉพาะข้อความตัวอักษร ประเภทอื่น (รูป สติกเกอร์ ไฟล์) ข้ามไปก่อน
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  // เก็บต้นฉบับตามที่ผู้ใช้พิมพ์มาทุกตัวอักษร ห้ามแก้ ส่วน text ใช้ตัดสินใจเท่านั้น
  const original = event.message.text;
  const text = original.trim();
  if (!userId || !text) return;

  const command = text.toLowerCase();
  if (MY_ID_KEYWORDS.includes(command)) {
    const role = config.teachers.has(userId) ? 'มีสิทธิ์สอนแล้ว' : 'ยังไม่มีสิทธิ์สอน';
    await deliver({ replyToken, userId, text: `ไอดีของคุณคือ\n${userId}\n\n(${role})` });
    return;
  }
  if (BOOK_KEYWORDS.includes(command)) {
    await deliver({ replyToken, userId, text: `อ่านหนังสือความรู้ของทีมได้ที่\n${bookLink()}` });
    return;
  }

  // แชทกลุ่มไม่รองรับ loading animation จึงเรียกเฉพาะแชทเดี่ยว
  if (event.source?.type === 'user') {
    await showLoading(userId, 60);
  }

  try {
    await inOrder(userId, () => respond({ userId, replyToken, text, original, command }));
  } catch (err) {
    console.error('[handler] ตอบข้อความไม่สำเร็จ:', err);
    // อย่าให้ error ทำให้ผู้ใช้เงียบหาย ต้องตอบอะไรกลับไปเสมอ
    await deliver({ replyToken, userId, text: ERROR_REPLY }).catch((sendErr) =>
      console.error('[handler] ส่งข้อความแจ้ง error ก็ไม่สำเร็จ:', sendErr),
    );
  }
}

async function respond({ userId, replyToken, text, original, command }) {
  const user = await kb.getUser(userId);
  if (!user?.display_name) {
    const profile = await getProfile(userId);
    await kb.saveUser(userId, profile?.displayName ?? null);
  }

  if (RESET_KEYWORDS.includes(command)) {
    await kb.resetContext(userId);
    await deliver({ replyToken, userId, text: 'เริ่มคุยเรื่องใหม่ได้เลยครับ (ความรู้ที่บันทึกไว้ยังอยู่ครบ)' });
    return;
  }

  // ดึงแชทก่อนหน้า "ก่อน" บันทึกข้อความนี้ ไม่งั้นข้อความนี้จะซ้ำสองรอบใน context
  const history = await kb.recentMessages(userId);
  const messageId = await kb.saveMessage(userId, 'user', original);
  const isTeacher = config.teachers.has(userId);

  let reply = null;
  const conflict = isTeacher ? await kb.getOpenConflict(userId) : null;
  if (conflict) {
    reply = await answerConflict({ conflict, userId, messageId, text, command, history });
  }
  if (reply === null) {
    reply = await handleMessage({ userId, messageId, text, history, isTeacher });
    if (conflict) {
      reply += '\n\n(ยังมีเรื่องขัดแย้งที่รอคำตอบจากคุณอยู่ ตอบได้ตลอด หรือพิมพ์ "ยกเลิก" ถ้าไม่ต้องบันทึก)';
    }
  }

  await kb.saveMessage(userId, 'assistant', reply);
  await deliver({ replyToken, userId, text: reply });
}

/** ข้อความทั่วไป: สอน ถาม หรือคุยเล่น */
async function handleMessage({ userId, messageId, text, history, isTeacher }) {
  const rules = await kb.listActiveRules();
  const result = await analyzeMessage({ text, history, rules });

  if (result.intent === 'teach' || result.intent === 'clarify') {
    if (!isTeacher) return NOT_TEACHER_REPLY;
  }
  if (result.intent !== 'teach') return result.reply;

  // AI อาจอ้าง id ที่ไม่มีอยู่จริง กรองทิ้งก่อนแตะฐานข้อมูล
  const known = new Set(rules.map((r) => r.id));
  const updates = result.updates.filter((u) => known.has(u.rule_id));
  const duplicateIds = result.duplicates.filter((id) => known.has(id));
  const conflicts = result.conflicts.filter((c) => c.rule_id === null || known.has(c.rule_id));

  if (conflicts.length > 0) {
    // ยังไม่บันทึก เก็บสิ่งที่ AI สรุปไว้ก่อน รอผู้ใช้ตัดสิน
    const ruleIds = [
      ...new Set([...conflicts.map((c) => c.rule_id).filter(Boolean), ...updates.map((u) => u.rule_id)]),
    ];
    await kb.createConflict({
      userId,
      messageId,
      proposed: { rules: result.rules, updates },
      ruleIds,
      explanation: conflicts.map((c) => c.explanation).join('\n'),
      question: result.reply,
    });
    return `⚠️ ${result.reply}\n\n(ตอบกลับมาได้เลย หรือพิมพ์ "ยกเลิก" ถ้าไม่ต้องการบันทึกเรื่องนี้)`;
  }

  const saved = await kb.saveTeaching({
    userId,
    messageId,
    rules: result.rules,
    updates,
    duplicateIds,
  });

  const parts = [result.reply];
  if (saved.length > 0) parts.push(describeSaved(saved));
  if (duplicateIds.length > 0) {
    const refs = duplicateIds.map((id) => `ข้อ #${id}`).join(', ');
    parts.push(`เรื่องนี้มีบันทึกไว้แล้วใน ${refs} ผมแนบคำพูดของคุณไว้เป็นหลักฐานเพิ่มแล้วครับ`);
  }
  return parts.join('\n\n');
}

/**
 * ผู้ใช้กำลังตอบคำถามเรื่องข้อขัดแย้ง
 * คืน null ถ้าผู้ใช้คุยเรื่องอื่น เพื่อให้ไปทำงานแบบข้อความปกติแทน
 */
async function answerConflict({ conflict, userId, messageId, text, command, history }) {
  if (CANCEL_KEYWORDS.includes(command)) {
    await kb.cancelConflict({
      conflictId: conflict.id,
      answerMessageId: messageId,
      decision: 'ผู้สอนยกเลิกเอง ไม่บันทึกเรื่องนี้',
    });
    return 'ยกเลิกแล้วครับ ไม่ได้บันทึกเรื่องนี้ และกฎเดิมยังใช้ต่อตามปกติ';
  }

  const [original, oldRules] = await Promise.all([
    kb.getMessage(conflict.message_id),
    kb.getRules(conflict.rule_ids),
  ]);
  const result = await resolveConflict({
    conflict,
    originalText: original?.text ?? '',
    oldRules,
    text,
    history,
  });

  switch (result.status) {
    case 'unrelated':
      return null;
    case 'ask_again':
      return result.reply;
    case 'cancelled':
      await kb.cancelConflict({
        conflictId: conflict.id,
        answerMessageId: messageId,
        decision: result.decision || 'ผู้สอนยกเลิก ไม่บันทึกเรื่องนี้',
      });
      return result.reply;
  }

  const { retired, added } = await kb.saveResolution({
    conflict,
    userId,
    answerMessageId: messageId,
    retireIds: result.retireIds,
    addRules: result.addRules,
    decision: result.decision || result.reply,
  });

  const parts = [result.reply];
  if (retired.length > 0) {
    parts.push(`🗂 เลิกใช้ ${retired.map((id) => `ข้อ #${id}`).join(', ')} (ยังเก็บไว้ในประวัติ)`);
  }
  if (added.length > 0) parts.push(describeSaved(added));
  if (retired.length === 0 && added.length === 0) parts.push('กฎเดิมยังใช้ต่อ ไม่มีอะไรเปลี่ยน');
  return parts.join('\n\n');
}
