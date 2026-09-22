import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { runDiagnostics } from './diag.js';
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

// หน้าตรวจสอบชั่วคราว ซ่อนไว้หลัง path ลับที่คำนวณจาก channel secret
// คนที่ไม่มี channel secret เดา path นี้ไม่ได้ ลบทิ้งได้เมื่อบอททำงานปกติแล้ว
const DIAG_KEY = crypto
  .createHash('sha256')
  .update(config.line.channelSecret)
  .digest('hex')
  .slice(0, 16);

app.get(`/diag/${DIAG_KEY}`, async (_req, res) => {
  res.json(await runDiagnostics());
});

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
