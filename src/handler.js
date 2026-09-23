import { transcribe } from './ai.js';
import { analyzeMessage, resolveConflict } from './brain.js';
import { bookCard, bookLink, cardText, conflictCard, quickReply, ruleCards } from './cards.js';
import { config } from './config.js';
import * as kb from './knowledge.js';
import { deliver, getMessageContent, getProfile, showLoading } from './line.js';

const RESET_KEYWORDS = ['เริ่มใหม่', 'ล้างประวัติ', 'reset', 'clear'];
const MY_ID_KEYWORDS = ['ไอดีของฉัน', 'ไอดี', 'myid'];
const BOOK_KEYWORDS = ['หนังสือ', 'ขอหนังสือ', 'book'];
const CANCEL_KEYWORDS = ['ยกเลิก', 'cancel'];

const UNSUPPORTED_REPLY = 'ตอนนี้ผมรับได้เฉพาะข้อความตัวอักษรกับข้อความเสียงครับ';
const VOICE_UNCLEAR_REPLY = 'ขออภัยครับ ฟังเสียงไม่ออก รบกวนพูดใหม่ชัด ๆ อีกครั้ง หรือพิมพ์มาแทนได้เลย';
const ERROR_REPLY ='ขออภัยครับ ระบบขัดข้องชั่วคราว รบกวนลองพิมพ์ใหม่อีกครั้ง';
const NOT_TEACHER_REPLY =
  'ขอบคุณที่เล่าให้ฟังครับ แต่บัญชีนี้ยังไม่มีสิทธิ์บันทึกความรู้เข้าหนังสือ ' +
  'ถ้าต้องการสอน ให้พิมพ์ "ไอดีของฉัน" แล้วส่งรหัสที่ได้ให้ผู้ดูแลเพิ่มสิทธิ์ให้';
const PENDING_NOTE =
  'ยังมีเรื่องที่ผมถามค้างไว้อยู่นะครับ ตอบเมื่อไหร่ก็ได้ หรือพิมพ์ "ยกเลิก" ถ้าไม่ต้องบันทึกเรื่องนั้น';
const WELCOME =
  'สวัสดีครับ ผมเป็นผู้ช่วยจดความรู้ของทีม\n\n' +
  '• เล่ากฎหรือวิธีทำงานให้ฟังได้เลย ผมจะสรุปเก็บไว้ ถ้าขัดกับของเดิมจะถามกลับก่อนบันทึก\n' +
  '• ถามเรื่องที่เคยมีคนสอนไว้ได้\n' +
  '• กดปุ่มด้านล่าง หรือพิมพ์คำสั่งก็ได้เหมือนกันครับ';

const MENU = quickReply(
  { label: '📖 หนังสือ', text: 'หนังสือ' },
  { label: '🆔 ไอดีของฉัน', text: 'ไอดีของฉัน' },
  { label: '🔄 เริ่มใหม่', text: 'เริ่มใหม่' },
);

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

const toCard = (rule, kind) => ({
  kind: kind ?? rule.kind ?? 'new',
  id: rule.id,
  replaces: rule.replaces,
  topic: rule.topic,
  summary: rule.summary,
});

/**
 * ประกอบผลลัพธ์เป็นชุดข้อความที่ส่งจริง พร้อมข้อความธรรมดาที่สื่อความหมายเดียวกัน
 *
 * ข้อความธรรมดาใช้สองที่ คือเก็บลงประวัติแชทให้ AI เห็นในรอบถัดไป
 * และเป็นตัวสำรองถ้า LINE ปฏิเสธการ์ด
 *
 * ส่งได้ไม่เกิน 5 ข้อความต่อครั้ง ที่นี่จึงรวมให้เหลืออย่างมาก 3 ก้อน
 * คือข้อความนำ การ์ด และหมายเหตุท้าย
 */
function render({ lead, cards = [], conflict = null, notes = [] }) {
  const messages = [];
  const lines = [];
  const add = (message, text) => {
    messages.push(message);
    lines.push(text);
  };

  if (lead) add({ type: 'text', text: lead }, lead);
  if (conflict) add(conflictCard(conflict), `⚠️ ${conflict}`);

  const rules = ruleCards(cards);
  if (rules) add(rules, cards.map(cardText).join('\n\n'));

  if (notes.length > 0) {
    const text = notes.join('\n\n');
    add({ type: 'text', text }, text);
  }

  return { messages, text: lines.join('\n\n') };
}

export async function handleEvent(event) {
  if (isDuplicate(event.webhookEventId)) {
    console.log('[handler] ข้าม event ซ้ำ', event.webhookEventId);
    return;
  }

  if (event.type === 'follow') {
    await deliver({
      replyToken: event.replyToken,
      userId: event.source?.userId,
      text: WELCOME,
      quickReply: MENU,
    });
    return;
  }

  if (event.type !== 'message') return;

  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  if (!userId) return;

  const type = event.message?.type;
  // สติกเกอร์มักเป็นแค่การทักหรือขอบคุณ เงียบไว้ดีกว่าตอบว่ารับไม่ได้
  if (type === 'sticker') return;
  if (type !== 'text' && type !== 'audio') {
    // ในกลุ่มคนส่งรูปกันเป็นปกติ ถ้าตอบทุกรูปจะรก จึงบอกเฉพาะแชทเดี่ยว
    if (event.source?.type === 'user') {
      await deliver({ replyToken, userId, text: UNSUPPORTED_REPLY });
    }
    return;
  }

  if (type === 'text') {
    const command = event.message.text.trim().toLowerCase();
    if (!command) return;
    if (MY_ID_KEYWORDS.includes(command)) {
      const role = config.teachers.has(userId) ? 'มีสิทธิ์สอนแล้ว' : 'ยังไม่มีสิทธิ์สอน';
      await deliver({ replyToken, userId, text: `ไอดีของคุณคือ\n${userId}\n\n(${role})` });
      return;
    }
    if (BOOK_KEYWORDS.includes(command)) {
      const card = bookCard();
      await deliver({
        replyToken,
        userId,
        text: `อ่านหนังสือความรู้ของทีมได้ที่\n${bookLink()}`,
        messages: card ? [card] : null,
      });
      return;
    }
  }

  // แชทกลุ่มไม่รองรับ loading animation จึงเรียกเฉพาะแชทเดี่ยว
  if (event.source?.type === 'user') {
    await showLoading(userId, 60);
  }

  try {
    await inOrder(userId, () => respond({ userId, replyToken, message: event.message }));
  } catch (err) {
    console.error('[handler] ตอบข้อความไม่สำเร็จ:', err);
    // อย่าให้ error ทำให้ผู้ใช้เงียบหาย ต้องตอบอะไรกลับไปเสมอ
    await deliver({ replyToken, userId, text: ERROR_REPLY }).catch((sendErr) =>
      console.error('[handler] ส่งข้อความแจ้ง error ก็ไม่สำเร็จ:', sendErr),
    );
  }
}

/**
 * ข้อความเสียง: ดาวน์โหลดไฟล์ แล้วถอดเป็นตัวอักษร
 * ส่งชื่อบทและชื่อกฎที่มีอยู่ไปเป็นคำใบ้ ให้ถอดศัพท์เฉพาะของทีมได้ถูกขึ้น
 */
async function listen(message) {
  const audio = await getMessageContent(message.id);
  const rules = await kb.listActiveRules();
  const hint = [...new Set(rules.flatMap((r) => [r.topic, r.title]))].join(', ').slice(0, 800);
  const transcript = await transcribe(audio.buffer, hint);
  return { transcript, audio: { ...audio, durationMs: message.duration } };
}

async function respond({ userId, replyToken, message }) {
  const user = await kb.getUser(userId);
  if (!user?.display_name) {
    const profile = await getProfile(userId);
    await kb.saveUser(userId, profile?.displayName ?? null);
  }

  // ดึงแชทก่อนหน้า "ก่อน" บันทึกข้อความนี้ ไม่งั้นข้อความนี้จะซ้ำสองรอบใน context
  const history = await kb.recentMessages(userId);

  // เก็บต้นฉบับตามที่ผู้ใช้ส่งมาทุกตัวอักษร ห้ามแก้ ส่วน text ใช้ตัดสินใจเท่านั้น
  let messageId;
  let text;
  let heard = '';
  if (message.type === 'audio') {
    const { transcript, audio } = await listen(message);
    // เก็บไฟล์เสียงไว้เสมอ แม้ถอดไม่ออก เพราะนี่คือต้นฉบับ
    messageId = await kb.saveVoiceMessage(userId, transcript, audio);
    if (!transcript) {
      await kb.saveMessage(userId, 'assistant', VOICE_UNCLEAR_REPLY);
      await deliver({ replyToken, userId, text: VOICE_UNCLEAR_REPLY });
      return;
    }
    text = transcript;
    heard = `🎤 ได้ยินว่า “${transcript}”`;
  } else {
    text = message.text.trim();
    messageId = await kb.saveMessage(userId, 'user', message.text);
  }

  const command = text.toLowerCase();
  if (RESET_KEYWORDS.includes(command)) {
    await kb.resetContext(userId);
    await deliver({ replyToken, userId, text: 'เริ่มคุยเรื่องใหม่ได้เลยครับ (ความรู้ที่บันทึกไว้ยังอยู่ครบ)' });
    return;
  }

  // บอก AI ว่าข้อความนี้ถอดจากเสียง จะได้ไม่ยึดคำที่ฟังเพี้ยนเป็นข้อเท็จจริง
  if (heard) text = `[ข้อความนี้ถอดจากเสียงพูด อาจมีคำที่ฟังผิด ถ้าตัวเลขหรือชื่อดูแปลกให้ถามยืนยัน]\n${text}`;
  const isTeacher = config.teachers.has(userId);

  let result = null;
  const conflict = isTeacher ? await kb.getOpenConflict(userId) : null;
  if (conflict) {
    result = await answerConflict({ conflict, userId, messageId, text, command, history });
  }
  if (result === null) {
    result = await handleMessage({ userId, messageId, text, history, isTeacher });
    // ตอบเรื่องอื่นไปแล้ว แต่ยังต้องเตือนว่าคำถามเดิมยังค้างอยู่
    if (conflict) result.notes = [...(result.notes ?? []), PENDING_NOTE];
  }

  if (heard) result.lead = result.lead ? `${heard}\n\n${result.lead}` : heard;

  const { messages, text: transcript } = render(result);
  await kb.saveMessage(userId, 'assistant', transcript);
  await deliver({ replyToken, userId, text: transcript, messages, quickReply: result.quickReply });
}

/** ข้อความทั่วไป: สอน ถาม หรือคุยเล่น */
async function handleMessage({ userId, messageId, text, history, isTeacher }) {
  const rules = await kb.listActiveRules();
  const result = await analyzeMessage({ text, history, rules });

  if (result.intent === 'teach' || result.intent === 'clarify') {
    if (!isTeacher) {
      return {
        lead: NOT_TEACHER_REPLY,
        quickReply: quickReply({ label: '🆔 ไอดีของฉัน', text: 'ไอดีของฉัน' }),
      };
    }
  }
  if (result.intent !== 'teach') return { lead: result.reply };

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
    // คำถามอยู่ในการ์ดอยู่แล้ว ไม่ต้องมีข้อความนำซ้ำอีกชั้น
    return { lead: '', conflict: result.reply };
  }

  const saved = await kb.saveTeaching({
    userId,
    messageId,
    rules: result.rules,
    updates,
    duplicateIds,
  });

  const notes = [];
  if (duplicateIds.length > 0) {
    const refs = duplicateIds.map((id) => `ข้อ #${id}`).join(', ');
    notes.push(`เรื่องนี้มีบันทึกไว้แล้วใน ${refs} ผมแนบคำพูดของคุณไว้เป็นหลักฐานเพิ่มแล้วครับ`);
  }
  // ถามต่อเฉพาะเมื่อบันทึกอะไรใหม่จริง คำตอบรอบหน้าจะกลายเป็นการเพิ่มรายละเอียดให้กฎข้อนี้
  if (saved.length > 0 && result.followUp.length > 0) {
    const questions = result.followUp.map((q, i) => `${i + 1}. ${q}`).join('\n');
    notes.push(
      `❓ ขอถามเพิ่มอีกนิด ให้กฎข้อนี้ครบขึ้นครับ\n\n${questions}\n\nไม่ทราบหรือไม่อยากตอบ ข้ามได้เลยครับ`,
    );
  }

  return { lead: result.reply, cards: saved.map((r) => toCard(r)), notes };
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
    return { lead: 'ยกเลิกแล้วครับ ไม่ได้บันทึกเรื่องนี้ และกฎเดิมยังใช้ต่อตามปกติ' };
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
      return { lead: '', conflict: result.reply };
    case 'cancelled':
      await kb.cancelConflict({
        conflictId: conflict.id,
        answerMessageId: messageId,
        decision: result.decision || 'ผู้สอนยกเลิก ไม่บันทึกเรื่องนี้',
      });
      return { lead: result.reply };
  }

  const { retired, added } = await kb.saveResolution({
    conflict,
    userId,
    answerMessageId: messageId,
    retireIds: result.retireIds,
    addRules: result.addRules,
    decision: result.decision || result.reply,
  });

  // กฎที่เลิกใช้ต้องหยิบเนื้อหามาจากฉบับเดิมที่ดึงไว้ก่อนหน้า saveResolution คืนมาแค่ id
  const byId = new Map(oldRules.map((r) => [r.id, r]));
  const cards = [
    ...retired.map((id) => byId.get(id)).filter(Boolean).map((r) => toCard(r, 'retired')),
    ...added.map((r) => toCard(r, 'new')),
  ];
  const notes = cards.length === 0 ? ['กฎเดิมยังใช้ต่อตามปกติ ไม่มีอะไรเปลี่ยน'] : [];

  return { lead: result.reply, cards, notes };
}
