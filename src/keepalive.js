/**
 * กันเครื่องหลับบนแพ็กเกจฟรีของ Render
 *
 * Render จะพักเครื่องเมื่อไม่มี request เข้ามา 15 นาที และปลุกกลับมาใช้เวลาราวครึ่งนาที
 * ซึ่งนานเกินกว่าที่ LINE จะรอ ทำให้ข้อความแรกที่ลูกค้าทักมาหายไป
 * ตัวนี้จึงยิงเข้า /health ของตัวเองเป็นระยะ เพื่อให้ Render เห็นว่ายังมี traffic อยู่
 *
 * ข้อจำกัดที่ต้องรู้: วิธีนี้ "กันหลับ" ได้ แต่ "ปลุก" ไม่ได้
 * ถ้าเครื่องหลับไปแล้ว (เช่นหลัง deploy ที่ล้มเหลว) ตัวนี้ก็หลับไปด้วย ปลุกตัวเองไม่ได้
 * จึงควรตั้ง cron-job.org ยิงจากข้างนอกไว้อีกชั้นด้วย
 */

// Render ใส่ตัวแปรนี้ให้อัตโนมัติ เป็น URL สาธารณะของ service
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

// 10 นาที ต่ำกว่าเกณฑ์ 15 นาทีของ Render พอสมควร เผื่อยิงพลาดไปหนึ่งครั้งก็ยังไม่หลับ
const INTERVAL_MS = Number(process.env.KEEPALIVE_INTERVAL_MS) || 10 * 60 * 1000;

export function startKeepAlive() {
  if (!EXTERNAL_URL) {
    // รันในเครื่องตัวเองหรือที่อื่นที่ไม่ใช่ Render ไม่ต้องกันหลับ
    console.log('[keepalive] ไม่ได้รันบน Render ข้ามการกันหลับ');
    return;
  }

  const minutes = Math.round(INTERVAL_MS / 60_000);
  console.log(`[keepalive] จะยิงเช็ก ${EXTERNAL_URL}/health ทุก ${minutes} นาที`);

  const timer = setInterval(async () => {
    try {
      const res = await fetch(`${EXTERNAL_URL}/health`, {
        signal: AbortSignal.timeout(30_000),
      });
      // log ไว้เพื่อให้ดูย้อนหลังได้ว่ากันหลับทำงานอยู่จริง ยิงถี่สุดแค่ 10 นาทีครั้ง ไม่รก
      if (res.ok) console.log('[keepalive] ยิงสำเร็จ ยังตื่นอยู่');
      else console.warn(`[keepalive] /health ตอบ ${res.status}`);
    } catch (err) {
      // ยิงพลาดหนึ่งครั้งไม่ใช่เรื่องใหญ่ รอบหน้ายิงใหม่
      console.warn('[keepalive] ยิงไม่สำเร็จ:', err.message);
    }
  }, INTERVAL_MS);

  // อย่าให้ timer นี้กันไม่ให้ process ปิดตัวตอน Render สั่ง shutdown
  timer.unref();
}
