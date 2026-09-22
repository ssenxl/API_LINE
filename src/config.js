const required = [
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'OPENAI_API_KEY',
  'DATABASE_URL',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[config] ขาด environment variable: ${missing.join(', ')}`);
  console.error('[config] ใส่ค่าในไฟล์ .env (รันเครื่องตัวเอง) หรือหน้า Environment ของ Render ให้ครบก่อนรัน');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;

export const config = {
  port,

  // URL สาธารณะของบอท ใช้สร้างลิงก์หนังสือ Render ใส่ RENDER_EXTERNAL_URL ให้เอง
  publicUrl: (
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${port}`
  ).replace(/\/+$/, ''),

  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  },

  ai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    model: process.env.OPENAI_MODEL || 'gpt-5',
    // ระดับการคิดของโมเดลตระกูล GPT-5: minimal | low | medium | high
    // ยิ่งสูงยิ่งละเอียดแต่ยิ่งช้า ไม่ตั้ง = ใช้ค่าเริ่มต้นของ OpenAI (medium)
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || '',
    // โมเดลตระกูล GPT-5 นับ token ที่ใช้ "คิด" รวมในเพดานนี้ด้วย จึงต้องเผื่อไว้เยอะ
    maxOutputTokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 8000,
    timeoutMs: 120_000,
  },

  database: {
    url: process.env.DATABASE_URL,
  },

  // LINE userId ของคนที่สอนบอทได้ คั่นด้วย comma
  // คนที่ไม่อยู่ในรายชื่อยังถามและอ่านหนังสือได้ แต่บอทจะไม่บันทึกสิ่งที่เขาสอน
  teachers: new Set(
    (process.env.TEACHER_USER_IDS || '')
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean),
  ),

  book: {
    title: process.env.BOOK_TITLE || 'สมุดความรู้ของทีม',
    // ถ้าตั้งไว้ ต้องเปิด /book?key=ค่านี้ ถึงจะอ่านได้ กันคนนอกที่เดา URL ได้
    key: process.env.BOOK_KEY || '',
    // ลิงก์สั้นสำหรับส่งต่อ เช่น scm-book → /scm-book เปิดได้โดยไม่ต้องมี key
    slug: (process.env.BOOK_SLUG || '').replace(/^\/+|\/+$/g, ''),
  },

  conversation: {
    // จำนวน "ข้อความ" (ไม่ใช่รอบสนทนา) ที่ส่งกลับไปเป็น context
    maxMessages: 20,
    // ลืมบทสนทนาถ้าเงียบไปเกินเวลานี้ (ความรู้ที่บันทึกแล้วไม่หาย แค่ AI ไม่เห็นแชทเก่า)
    ttlMinutes: 30,
  },
};
