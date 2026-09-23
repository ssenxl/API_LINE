import { config } from './config.js';

/**
 * การ์ด Flex Message ที่บอทส่งกลับไปใน LINE
 *
 * ใช้โทนสีชุดเดียวกับหนังสือใน book.js ให้ดูเป็นของชิ้นเดียวกัน
 * Flex ไม่มีโหมดมืด สีทุกอย่างจึงต้องกำหนดเองให้อ่านออกบนพื้นขาว
 *
 * ทุกการ์ดต้องมีข้อความธรรมดาคู่กันเสมอ (cardText) เพราะใช้เป็น altText
 * ใน LINE เวอร์ชันที่แสดง Flex ไม่ได้ และใช้เป็น context ให้ AI รอบถัดไปด้วย
 */

const C = {
  paper: '#FFFDF9',
  ink: '#232019',
  muted: '#7C7469',
  line: '#EAE3D7',
  accent: '#8A4B16',
  warn: '#9A5B00',
  grey: '#6B655C',
  white: '#FFFFFF',
  onDark: '#FFFFFFCC',
};

const ALT_LIMIT = 400; // LINE ตัด altText ที่ยาวเกินนี้ทิ้งทั้งข้อความ

export function bookLink(anchor) {
  const base = config.book.slug
    ? `${config.publicUrl}/${config.book.slug}`
    : `${config.publicUrl}/book${config.book.key ? `?key=${encodeURIComponent(config.book.key)}` : ''}`;
  return anchor ? `${base}#${anchor}` : base;
}

/**
 * LINE รับเฉพาะลิงก์ https ตอนรันบนเครื่องตัวเองจะเป็น http://localhost
 * ถ้าใส่ปุ่มไปทั้งการ์ดจะถูกปฏิเสธ จึงตัดปุ่มออกแทน
 */
const canLink = () => config.publicUrl.startsWith('https://');

const flex = (altText, contents) => ({
  type: 'flex',
  altText: altText.replace(/\s+/g, ' ').trim().slice(0, ALT_LIMIT),
  contents,
});

/** แถบหัวการ์ด: ชื่อสถานะทางซ้าย เลขข้อทางขวา */
function header(label, right, color) {
  return {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: color,
    paddingAll: '12px',
    paddingStart: '16px',
    paddingEnd: '16px',
    contents: [
      { type: 'text', text: label, color: C.white, size: 'sm', weight: 'bold', flex: 1 },
      ...(right ? [{ type: 'text', text: right, color: C.onDark, size: 'sm', align: 'end', flex: 0 }] : []),
    ],
  };
}

const body = (contents) => ({
  type: 'box',
  layout: 'vertical',
  backgroundColor: C.paper,
  paddingAll: '16px',
  contents,
});

function linkFooter(label, anchor) {
  if (!canLink()) return undefined;
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: C.paper,
    paddingAll: '4px',
    contents: [
      {
        type: 'button',
        style: 'link',
        height: 'sm',
        color: C.accent,
        action: { type: 'uri', label, uri: bookLink(anchor) },
      },
    ],
  };
}

// ---------- การ์ดกฎที่เพิ่งบันทึก / ปรับ / เลิกใช้ ----------

const KIND = {
  new: { label: 'บันทึกใหม่', color: C.accent },
  updated: { label: 'ปรับปรุงแล้ว', color: C.accent },
  retired: { label: 'เลิกใช้แล้ว', color: C.grey },
};

/** ข้อความธรรมดาที่สื่อความหมายเดียวกับการ์ด */
export function cardText(card) {
  const head =
    card.kind === 'updated'
      ? `✏️ ปรับข้อ #${card.replaces} เป็นข้อ #${card.id}`
      : card.kind === 'retired'
        ? `🗂 เลิกใช้ข้อ #${card.id}`
        : `📝 บันทึกข้อ #${card.id}`;
  return `${head} · ${card.topic}\n${card.summary}`;
}

function ruleBubble(card) {
  const kind = KIND[card.kind] ?? KIND.new;
  const lines = [
    { type: 'text', text: card.topic, size: 'xs', weight: 'bold', color: kind.color, wrap: true },
    { type: 'text', text: card.summary, size: 'sm', color: C.ink, wrap: true, margin: 'sm' },
  ];
  if (card.replaces) {
    lines.push(
      { type: 'separator', margin: 'lg', color: C.line },
      {
        type: 'text',
        text: `รวมกับข้อ #${card.replaces} ที่เคยบันทึกไว้`,
        size: 'xxs',
        color: C.muted,
        wrap: true,
        margin: 'lg',
      },
    );
  }

  return {
    type: 'bubble',
    header: header(kind.label, `ข้อ #${card.id}`, kind.color),
    body: body(lines),
    footer: linkFooter('เปิดในหนังสือ', `rule-${card.id}`),
  };
}

/**
 * การ์ดเดียวส่งเป็น bubble เต็มความกว้าง หลายข้อส่งเป็น carousel ให้เลื่อนดู
 * LINE รับ carousel ได้สูงสุด 12 ใบ
 */
export function ruleCards(cards) {
  if (cards.length === 0) return null;

  const bubbles = cards.slice(0, 12).map(ruleBubble);
  const contents =
    bubbles.length === 1
      ? { ...bubbles[0], size: 'mega' }
      : { type: 'carousel', contents: bubbles.map((b) => ({ ...b, size: 'kilo' })) };

  return flex(cards.map(cardText).join(' / '), contents);
}

// ---------- การ์ดถามกลับเรื่องที่ขัดกับของเดิม ----------

export function conflictCard(question) {
  return flex(
    `⚠️ ${question}`,
    {
      type: 'bubble',
      size: 'mega',
      header: header('ขอเช็กก่อนบันทึก', null, C.warn),
      body: body([
        { type: 'text', text: question, size: 'sm', color: C.ink, wrap: true },
        { type: 'separator', margin: 'lg', color: C.line },
        {
          type: 'text',
          text: 'เรื่องนี้ยังไม่ได้บันทึก ตอบกลับมาได้เลยครับ ผมจะบันทึกตามที่คุณยืนยัน',
          size: 'xxs',
          color: C.muted,
          wrap: true,
          margin: 'lg',
        },
      ]),
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: C.paper,
        paddingAll: '4px',
        contents: [
          {
            type: 'button',
            style: 'link',
            height: 'sm',
            color: C.muted,
            action: { type: 'message', label: 'ไม่ต้องบันทึก', text: 'ยกเลิก' },
          },
        ],
      },
    },
  );
}

// ---------- การ์ดลิงก์หนังสือ ----------

export function bookCard() {
  if (!canLink()) return null;

  return flex(`อ่านหนังสือความรู้ของทีมได้ที่ ${bookLink()}`, {
    type: 'bubble',
    size: 'mega',
    header: header('ลิงก์หนังสือ', null, C.accent),
    body: body([
      { type: 'text', text: config.book.title, size: 'md', weight: 'bold', color: C.ink, wrap: true },
      {
        type: 'text',
        text: 'รวมทุกกฎที่ทีมสอนไว้ เรียบเรียงเป็นบท พร้อมคำพูดต้นฉบับของผู้สอน',
        size: 'xs',
        color: C.muted,
        wrap: true,
        margin: 'md',
      },
    ]),
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: C.paper,
      paddingAll: '12px',
      contents: [
        {
          type: 'button',
          style: 'primary',
          height: 'sm',
          color: C.accent,
          action: { type: 'uri', label: 'เปิดหนังสือ', uri: bookLink() },
        },
      ],
    },
  });
}

// ---------- ปุ่มลัดใต้ข้อความ ----------

/** label ยาวได้ไม่เกิน 20 ตัวอักษร ยาวกว่านั้น LINE ปฏิเสธทั้งข้อความ */
export const quickReply = (...items) => ({
  items: items.map(({ label, text }) => ({
    type: 'action',
    action: { type: 'message', label: label.slice(0, 20), text },
  })),
});
