const required = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'OPENAI_API_KEY'];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[config] ขาด environment variable: ${missing.join(', ')}`);
  console.error('[config] คัดลอก .env.example เป็น .env แล้วใส่ค่าให้ครบก่อนรัน');
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT) || 3000,

  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  },

  ai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    systemPrompt:
      process.env.SYSTEM_PROMPT ||
      'คุณเป็นผู้ช่วยของ LINE Official Account ตอบเป็นภาษาไทยสั้น กระชับ สุภาพ',
    // LINE ตัดข้อความที่ยาวเกิน 5000 ตัวอักษร จำกัดฝั่ง AI ไว้ต่ำกว่านั้น
    maxOutputTokens: 800,
    timeoutMs: 60_000,
  },

  conversation: {
    // จำนวน "ข้อความ" (ไม่ใช่รอบสนทนา) ที่ส่งกลับไปเป็น context
    maxMessages: 20,
    // ลืมบทสนทนาถ้าเงียบไปเกินเวลานี้
    ttlMs: 30 * 60 * 1000,
  },
};
