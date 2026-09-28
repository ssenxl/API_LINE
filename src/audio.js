import { getAudio } from './knowledge.js';

/**
 * ส่งไฟล์เสียงต้นฉบับของข้อความ ใช้ทั้งปุ่มฟังเสียงในหนังสือและในหน้าผู้ดูแล
 * ผู้เรียกต้องตรวจสิทธิ์ก่อนเรียกเสมอ
 */
export async function sendAudio(req, res, messageId) {
  try {
    const audio = await getAudio(messageId);
    if (!audio) return res.status(404).end();

    const data = audio.data;
    res.set({
      'Content-Type': audio.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400',
    });

    // Safari บน iPhone ขอไฟล์เสียงเป็นช่วง ๆ (Range) ถ้าตอบทั้งไฟล์ไปมันจะไม่ยอมเล่น
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') ?? '');
    if (range) {
      let start = range[1] === '' ? data.length - Number(range[2]) : Number(range[1]);
      let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : data.length - 1;
      start = Math.max(0, start);
      end = Math.min(end, data.length - 1);
      if (start > end) {
        return res.status(416).set('Content-Range', `bytes */${data.length}`).end();
      }
      return res
        .status(206)
        .set('Content-Range', `bytes ${start}-${end}/${data.length}`)
        .send(data.subarray(start, end + 1));
    }
    res.send(data);
  } catch (err) {
    console.error('[audio] ส่งไฟล์เสียงไม่สำเร็จ:', err);
    res.status(500).end();
  }
}
