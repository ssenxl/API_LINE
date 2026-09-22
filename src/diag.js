import { config } from './config.js';

/**
 * หน้าตรวจสอบชั่วคราว ไว้ไล่หาสาเหตุตอนบอทไม่ตอบ
 * บอกแค่ว่าค่าลับ "ใช้ได้หรือไม่" และ "ยาวกี่ตัวอักษร" ไม่เปิดเผยตัวค่าจริง
 *
 * เมื่อบอททำงานปกติแล้วควรลบไฟล์นี้กับ route ใน server.js ทิ้ง
 * เพราะเปิดทิ้งไว้เท่ากับบอกคนนอกว่าระบบตั้งค่าครบหรือยัง
 */
export async function runDiagnostics() {
  const result = {
    env: {
      LINE_CHANNEL_SECRET: describe(config.line.channelSecret),
      LINE_CHANNEL_ACCESS_TOKEN: describe(config.line.accessToken),
      OPENAI_API_KEY: describe(config.ai.apiKey),
      OPENAI_MODEL: config.ai.model,
    },
    lineToken: await checkLineToken(),
  };
  return result;
}

function describe(value) {
  if (!value) return 'ไม่ได้ตั้งค่า';
  const trimmed = value.trim();
  return {
    ความยาว: value.length,
    มีช่องว่างหัวท้าย: trimmed !== value,
    ขึ้นต้นด้วย: value.slice(0, 4),
  };
}

/** ถาม LINE ตรง ๆ ว่า access token ที่ถืออยู่ใช้ได้ไหม */
async function checkLineToken() {
  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${config.line.accessToken}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ใช้ได้: true, ชื่อบอท: body.displayName, id: body.basicId };
    return { ใช้ได้: false, status: res.status, ข้อความ: body.message };
  } catch (err) {
    return { ใช้ได้: false, ข้อผิดพลาด: err.message };
  }
}
