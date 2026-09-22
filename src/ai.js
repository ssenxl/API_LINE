import OpenAI from 'openai';
import { config } from './config.js';

/**
 * จุดเชื่อมกับ AI ภายนอกทั้งหมดอยู่ในไฟล์นี้ไฟล์เดียว
 * ถ้าจะเปลี่ยนไปใช้ AI เจ้าอื่นหรือ endpoint ของตัวเอง แก้แค่ askAI()
 */
const client = new OpenAI({
  apiKey: config.ai.apiKey,
  baseURL: config.ai.baseURL,
  timeout: config.ai.timeoutMs,
  maxRetries: 2,
});

/**
 * @param {Array<{role: 'user'|'assistant', content: string}>} history
 *        ประวัติการคุย รวมข้อความล่าสุดของผู้ใช้เป็นรายการสุดท้าย
 * @returns {Promise<string>} ข้อความตอบกลับ
 */
export async function askAI(history) {
  const completion = await client.chat.completions.create({
    model: config.ai.model,
    max_tokens: config.ai.maxOutputTokens,
    messages: [{ role: 'system', content: config.ai.systemPrompt }, ...history],
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error('AI ตอบกลับมาเป็นค่าว่าง');
  return text;
}
