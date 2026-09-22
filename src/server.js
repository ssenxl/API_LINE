import express from 'express';
import { config } from './config.js';
import { verifySignature } from './line.js';
import { handleEvent } from './handler.js';
import { startKeepAlive } from './keepalive.js';

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

app.listen(config.port, () => {
  console.log(`[server] ฟังอยู่ที่พอร์ต ${config.port}`);
  console.log(`[server] webhook path: POST /webhook`);
  console.log(`[server] โมเดล AI: ${config.ai.model}`);
  startKeepAlive();
});
