import crypto from 'node:crypto';
import { config } from './config.js';

const API = 'https://api.line.me/v2/bot';
const TEXT_LIMIT = 5000; // LINE ปฏิเสธข้อความที่ยาวเกินนี้
const MAX_MESSAGES = 5; // ส่งได้สูงสุด 5 ข้อความต่อหนึ่ง request

/**
 * ตรวจว่า request มาจาก LINE จริง ไม่ใช่คนยิงมั่ว
 * ต้องคำนวณจาก raw body ก่อนถูก JSON.parse ไม่งั้น signature จะไม่ตรง
 */
export function verifySignature(rawBody, signature) {
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', config.line.channelSecret)
    .update(rawBody)
    .digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // ความยาวต่างกัน timingSafeEqual จะ throw จึงต้องเช็กก่อน
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function callLine(path, payload) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.line.accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`LINE ${path} ตอบ ${res.status}: ${body}`);
    error.status = res.status;
    throw error;
  }
  return res;
}

/** ตัดข้อความยาวให้เป็นหลายก้อน โดยพยายามตัดที่ขึ้นบรรทัดใหม่ก่อน */
function toTextMessages(text) {
  const clean = (text || '').trim() || 'ขออภัย ระบบไม่มีข้อความตอบกลับ';
  const chunks = [];
  let rest = clean;

  while (rest.length > TEXT_LIMIT && chunks.length < MAX_MESSAGES - 1) {
    let cut = rest.lastIndexOf('\n', TEXT_LIMIT);
    if (cut < TEXT_LIMIT * 0.5) cut = TEXT_LIMIT; // ไม่เจอจุดตัดที่ดี ตัดตรง ๆ
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  chunks.push(rest.slice(0, TEXT_LIMIT));

  return chunks.map((t) => ({ type: 'text', text: t }));
}

/**
 * ส่งชุดข้อความที่ประกอบไว้แล้ว โดยพยายามใช้ reply ก่อนเพราะฟรีและไม่กินโควต้า
 * ถ้า replyToken หมดอายุ (AI ตอบช้าเกิน 30 วินาที) ค่อย fallback ไป push
 */
async function send({ replyToken, userId, messages }) {
  if (replyToken) {
    try {
      await callLine('/message/reply', { replyToken, messages });
      return 'reply';
    } catch (err) {
      // 400 = token หมดอายุหรือถูกใช้ไปแล้ว กรณีอื่นถือว่าเป็นปัญหาจริง
      if (err.status !== 400 || !userId) throw err;
      console.warn('[line] reply ไม่สำเร็จ เปลี่ยนไปใช้ push:', err.message);
    }
  }

  if (!userId) throw new Error('ไม่มีทั้ง replyToken ที่ใช้ได้และ userId');
  await callLine('/message/push', { to: userId, messages });
  return 'push';
}

/**
 * ส่งข้อความกลับหาผู้ใช้
 * - messages: LINE message object ที่ประกอบไว้แล้ว (เช่น flex) ไม่ใส่มาก็จะใช้ text แทน
 * - text: ต้องมีเสมอ ใช้เป็นตัวสำรองถ้าการ์ดถูก LINE ปฏิเสธ ผู้ใช้จะได้ไม่เงียบหาย
 * - quickReply: ปุ่มลัด ติดได้กับข้อความสุดท้ายเท่านั้น
 */
export async function deliver({ replyToken, userId, text, messages, quickReply }) {
  const withQuickReply = (list) => {
    if (!quickReply) return list;
    return [...list.slice(0, -1), { ...list[list.length - 1], quickReply }];
  };

  try {
    const list = messages?.length ? messages.slice(0, MAX_MESSAGES) : toTextMessages(text);
    return await send({ replyToken, userId, messages: withQuickReply(list) });
  } catch (err) {
    if (!messages?.length) throw err;
    // การ์ดผิดรูปแบบไม่ควรทำให้ผู้ใช้ไม่ได้รับคำตอบเลย ถอยไปส่งข้อความธรรมดาแทน
    console.error('[line] ส่งการ์ดไม่สำเร็จ ถอยไปส่งข้อความธรรมดา:', err.message);
    return await send({ replyToken, userId, messages: withQuickReply(toTextMessages(text)) });
  }
}

/**
 * ดาวน์โหลดไฟล์ที่ผู้ใช้ส่งมา (เสียง รูป ฯลฯ) LINE เก็บไฟล์ไว้ให้ช่วงสั้น ๆ เท่านั้น ต้องดึงทันที
 * ไฟล์อยู่คนละโดเมนกับ API อื่น (api-data แทน api)
 */
export async function getMessageContent(messageId) {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
    { headers: { Authorization: `Bearer ${config.line.accessToken}` } },
  );
  if (!res.ok) throw new Error(`ดึงไฟล์จาก LINE ไม่สำเร็จ: ${res.status}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    mime: res.headers.get('content-type') || 'audio/m4a',
  };
}

/**
 * ดึงชื่อที่แสดงใน LINE ไว้บอกในหนังสือว่าใครเป็นคนสอน
 * ได้เฉพาะคนที่แอด OA เป็นเพื่อนแล้ว ถ้าไม่ได้ให้คืน null แทนการ throw
 */
export async function getProfile(userId) {
  try {
    const res = await fetch(`${API}/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${config.line.accessToken}` },
    });
    if (!res.ok) throw new Error(`ตอบ ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[line] ดึงโปรไฟล์ไม่สำเร็จ:', err.message);
    return null;
  }
}

/**
 * แสดงจุดสามจุดกระพริบระหว่างรอ AI ใช้ได้เฉพาะแชท 1:1 เท่านั้น
 * ถ้าพังไม่ต้องหยุดการทำงาน เพราะเป็นแค่ลูกเล่น
 */
export async function showLoading(userId, seconds = 20) {
  try {
    await callLine('/chat/loading/start', {
      chatId: userId,
      // ค่าที่ LINE ยอมรับคือ 5-60 และต้องหาร 5 ลงตัว
      loadingSeconds: Math.min(60, Math.max(5, Math.round(seconds / 5) * 5)),
    });
  } catch (err) {
    console.warn('[line] แสดง loading ไม่สำเร็จ:', err.message);
  }
}
