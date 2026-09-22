import { config } from './config.js';

/**
 * เก็บประวัติการสนทนาไว้ในหน่วยความจำ
 * ข้อจำกัด: หายเมื่อ restart และใช้ได้กับเซิร์ฟเวอร์เครื่องเดียว
 * ถ้าขึ้น production แบบหลาย instance ให้เปลี่ยนไปใช้ Redis
 */
const sessions = new Map(); // userId -> { messages, updatedAt }

function getSession(userId) {
  const existing = sessions.get(userId);
  if (existing && Date.now() - existing.updatedAt < config.conversation.ttlMs) {
    return existing;
  }
  const fresh = { messages: [], updatedAt: Date.now() };
  sessions.set(userId, fresh);
  return fresh;
}

/** เพิ่มข้อความผู้ใช้ แล้วคืน context ทั้งหมดที่จะส่งให้ AI */
export function appendUserMessage(userId, content) {
  const session = getSession(userId);
  session.messages.push({ role: 'user', content });
  trim(session);
  session.updatedAt = Date.now();
  return [...session.messages];
}

export function appendAssistantMessage(userId, content) {
  const session = getSession(userId);
  session.messages.push({ role: 'assistant', content });
  trim(session);
  session.updatedAt = Date.now();
}

/** ลบประวัติทิ้ง ใช้ตอนผู้ใช้พิมพ์ว่า "เริ่มใหม่" */
export function resetConversation(userId) {
  sessions.delete(userId);
}

function trim(session) {
  const { maxMessages } = config.conversation;
  if (session.messages.length > maxMessages) {
    session.messages = session.messages.slice(-maxMessages);
  }
}

// เก็บกวาดบทสนทนาที่หมดอายุ ไม่ให้ Map โตไปเรื่อย ๆ
const sweeper = setInterval(() => {
  const cutoff = Date.now() - config.conversation.ttlMs;
  for (const [userId, session] of sessions) {
    if (session.updatedAt < cutoff) sessions.delete(userId);
  }
}, 5 * 60 * 1000);
sweeper.unref();
