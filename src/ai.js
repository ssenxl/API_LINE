import OpenAI, { toFile } from 'openai';
import { config } from './config.js';

/**
 * จุดเชื่อมกับ AI ภายนอกทั้งหมดอยู่ในไฟล์นี้ไฟล์เดียว
 * ถ้าจะเปลี่ยนไปใช้ AI เจ้าอื่นหรือ endpoint ของตัวเอง แก้แค่ askJSON()
 */
const client = new OpenAI({
  apiKey: config.ai.apiKey,
  baseURL: config.ai.baseURL,
  timeout: config.ai.timeoutMs,
  maxRetries: 2,
});

/**
 * ถาม AI แล้วบังคับให้ตอบกลับเป็น JSON object
 *
 * @param {string} system คำสั่งหลัก ต้องมีคำว่า JSON อยู่ในนั้น (OpenAI บังคับ)
 * @param {Array<{role: 'user'|'assistant', content: string}>} messages
 * @returns {Promise<object>}
 */
export async function askJSON(system, messages) {
  const completion = await client.chat.completions.create({
    model: config.ai.model,
    // ใช้ max_completion_tokens แทน max_tokens เพราะโมเดลตระกูล GPT-5 ไม่รับ max_tokens
    // ส่วนโมเดลรุ่นเก่าอย่าง gpt-4o-mini รับได้ทั้งสองแบบ
    max_completion_tokens: config.ai.maxOutputTokens,
    // ส่งเฉพาะเมื่อตั้งค่าไว้ เพราะโมเดลรุ่นเก่าที่ไม่ได้ "คิด" ก่อนตอบจะปฏิเสธพารามิเตอร์นี้
    ...(config.ai.reasoningEffort && { reasoning_effort: config.ai.reasoningEffort }),
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, ...messages],
  });

  // log ไว้ดูค่าใช้จ่ายใน Render → Logs ว่าแต่ละรอบกิน token ไปเท่าไหร่
  const used = completion.usage;
  if (used) {
    console.log(`[ai] token: เข้า ${used.prompt_tokens} + ออก ${used.completion_tokens}`);
  }

  const choice = completion.choices[0];
  const text = choice?.message?.content?.trim();
  if (!text) {
    // finish_reason = length แปลว่าโมเดลคิดจนหมดเพดาน token ก่อนจะได้ตอบ
    throw new Error(`AI ตอบกลับมาเป็นค่าว่าง (finish_reason: ${choice?.finish_reason})`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`AI ตอบกลับมาไม่ใช่ JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * ถอดเสียงพูดเป็นข้อความ
 *
 * @param {Buffer} buffer ไฟล์เสียง (LINE ส่งมาเป็น m4a)
 * @param {string} hint คำศัพท์ที่น่าจะได้ยิน ช่วยให้ถอดชื่อเฉพาะได้ถูกขึ้น
 * @returns {Promise<string>} ข้อความที่ถอดได้ อาจเป็นค่าว่างถ้าฟังไม่ออก
 */
export async function transcribe(buffer, hint = '') {
  const result = await client.audio.transcriptions.create({
    model: config.ai.transcribeModel,
    // ชื่อไฟล์ต้องลงท้าย .m4a ไม่งั้น OpenAI ไม่รู้ว่าเป็นไฟล์ชนิดไหน
    file: await toFile(buffer, 'voice.m4a', { type: 'audio/m4a' }),
    language: 'th',
    ...(hint && { prompt: hint }),
  });
  return (result.text ?? '').trim();
}
