import crypto from 'node:crypto';
import express from 'express';
import { renderBook } from './book.js';
import { config } from './config.js';
import { migrate } from './db.js';
import { handleEvent } from './handler.js';
import { startKeepAlive } from './keepalive.js';
import { verifySignature } from './line.js';

const app = express();

// ต้องเก็บ raw body ไว้ก่อน เพราะ signature คำนวณจาก byte ดิบ
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// ไว้ให้ uptime monitor หรือ Cloud Run เช็กว่าเซิร์ฟเวอร์ยังอยู่
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/webhook', (req, res) => {
  if (!verifySignature(req.rawBody, req.get('x-line-signature'))) {
    console.warn('[server] signature ไม่ถูกต้อง ปฏิเสธ request');
    return res.status(401).send('invalid signature');
  }

  // LINE รอแค่ประมาณ 1 วินาที แต่ AI ใช้เวลานานกว่านั้นมาก
  // จึงต้องตอบ 200 ทันที แล้วค่อยประมวลผลต่อเบื้องหลัง
  res.status(200).end();

  const events = req.body?.events ?? [];
  for (const event of events) {
    handleEvent(event).catch((err) =>
      console.error('[server] handler พังแบบไม่ได้ดัก:', err),
    );
  }
});

function keyMatches(given) {
  if (!config.book.key) return true;
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(config.book.key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get('/book', async (req, res) => {
  if (!keyMatches(req.query.key)) {
    return res
      .status(401)
      .type('text/plain; charset=utf-8')
      .send('ต้องเปิดจากลิงก์ที่ได้จากบอท (พิมพ์ "หนังสือ" ใน LINE)');
  }
  try {
    res.type('html').send(await renderBook());
  } catch (err) {
    console.error('[server] สร้างหนังสือไม่สำเร็จ:', err);
    res.status(500).type('text/plain; charset=utf-8').send('สร้างหนังสือไม่สำเร็จ ลองใหม่อีกครั้ง');
  }
});

try {
  await migrate();
} catch (err) {
  console.error('[server] เชื่อมฐานข้อมูลไม่ได้ ตรวจค่า DATABASE_URL:', err.message);
  process.exit(1);
}

app.listen(config.port, () => {
  console.log(`[server] ฟังอยู่ที่พอร์ต ${config.port}`);
  console.log(`[server] webhook: POST /webhook · หนังสือ: GET /book`);
  console.log(`[server] โมเดล AI: ${config.ai.model}`);
  if (config.teachers.size === 0) {
    console.warn('[server] ยังไม่ได้ตั้ง TEACHER_USER_IDS ตอนนี้จึงไม่มีใครสอนบอทได้');
  } else {
    console.log(`[server] ผู้มีสิทธิ์สอน ${config.teachers.size} คน`);
  }
  startKeepAlive();
});
