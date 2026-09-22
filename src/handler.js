import { askAI } from './ai.js';
import { deliver, showLoading } from './line.js';
import {
  appendAssistantMessage,
  appendUserMessage,
  resetConversation,
} from './conversation.js';

const RESET_KEYWORDS = ['เริ่มใหม่', 'ล้างประวัติ', 'reset', 'clear'];
const ERROR_REPLY = 'ขออภัยครับ ระบบขัดข้องชั่วคราว รบกวนลองพิมพ์ใหม่อีกครั้ง';

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

export async function handleEvent(event) {
  if (isDuplicate(event.webhookEventId)) {
    console.log('[handler] ข้าม event ซ้ำ', event.webhookEventId);
    return;
  }

  if (event.type === 'follow') {
    await deliver({
      replyToken: event.replyToken,
      userId: event.source?.userId,
      text: 'ขอบคุณที่เพิ่มเพื่อนครับ พิมพ์คำถามเข้ามาได้เลย',
    });
    return;
  }

  // รองรับเฉพาะข้อความตัวอักษร ประเภทอื่น (รูป สติกเกอร์ ไฟล์) ข้ามไปก่อน
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  const text = event.message.text.trim();
  if (!userId || !text) return;

  if (RESET_KEYWORDS.includes(text.toLowerCase())) {
    resetConversation(userId);
    await deliver({ replyToken, userId, text: 'ล้างประวัติการสนทนาแล้วครับ' });
    return;
  }

  // แชทกลุ่มไม่รองรับ loading animation จึงเรียกเฉพาะแชทเดี่ยว
  if (event.source?.type === 'user') {
    await showLoading(userId);
  }

  try {
    const history = appendUserMessage(userId, text);
    const answer = await askAI(history);
    appendAssistantMessage(userId, answer);
    await deliver({ replyToken, userId, text: answer });
  } catch (err) {
    console.error('[handler] ตอบคำถามไม่สำเร็จ:', err);
    // อย่าให้ error ของ AI ทำให้ผู้ใช้เงียบหาย ต้องตอบอะไรกลับไปเสมอ
    await deliver({ replyToken, userId, text: ERROR_REPLY }).catch((sendErr) =>
      console.error('[handler] ส่งข้อความแจ้ง error ก็ไม่สำเร็จ:', sendErr),
    );
  }
}
