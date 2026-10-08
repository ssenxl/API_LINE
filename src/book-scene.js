/**
 * ฉาก 3 มิติของหน้าหนังสือ
 *
 * การ์ดแก้วลอยเป็นวงรอบตัวการ์ตูนที่ยืนอยู่กลางฉาก ลากเพื่อหมุนดูได้รอบทิศ
 * แตะการ์ดแล้วเนื้อหาส่วนนั้นเลื่อนเข้ามาให้อ่าน
 * ใช้ CSS 3D กับ canvas ธรรมดา ไม่พึ่งไลบรารีภายนอก ตัวการ์ตูนเป็นรูปมาสคอตใน public/mascot.webp
 *
 * ถ้าเบราว์เซอร์ปิด JavaScript หรือสั่งพิมพ์ ฉากนี้จะถูกซ่อน เหลือหนังสือเรียงต่อกันทั้งเล่มแบบเดิม
 *
 * ไฟล์นี้ยังเก็บธีม (สี ตัวอักษร พื้นหลังน้ำย้อม ผ้าตัวอย่าง) ที่หน้าผู้ดูแลใช้ร่วมด้วย ทั้งสองหน้าจะได้หน้าตาชุดเดียวกัน
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------- ไฟล์ประกอบ ----------

/** โฟลเดอร์ไฟล์ประกอบหน้าเว็บ (รูปตัวการ์ตูนกับโลโก้) เซิร์ฟเวอร์เปิดให้โหลดที่ /static */
export const STATIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

/**
 * ลิงก์ของไฟล์ในโฟลเดอร์ public มีรหัสย่อของเนื้อไฟล์ต่อท้าย
 * เบราว์เซอร์จึงเก็บไฟล์ไว้ใช้ได้ยาว และเห็นของใหม่ทันทีเมื่อเปลี่ยนไฟล์ ถ้าไม่มีไฟล์คืนค่าว่าง
 */
function staticUrl(name) {
  try {
    const file = fs.readFileSync(`${STATIC_DIR}/${name}`);
    return `/static/${name}?v=${crypto.createHash('sha1').update(file).digest('hex').slice(0, 10)}`;
  } catch {
    return '';
  }
}

/**
 * รูปตัวการ์ตูนที่ยืนอยู่กลางฉาก จะเปลี่ยนตัวการ์ตูนให้วางรูปใหม่ทับ public/mascot.webp (พื้นหลังโปร่งใส ยืนเต็มตัว)
 * ไม่มีไฟล์นี้ก็ไม่เป็นไร ฉากยังใช้ได้ แค่ไม่มีตัวการ์ตูน
 */
export const MASCOT_URL = staticUrl('mascot.webp');

/**
 * โลโก้บริษัทที่หัวหน้าของทุกหน้า จะเปลี่ยนโลโก้ให้วางรูปใหม่ทับ public/logo.png (พื้นหลังโปร่งใส สีเดียว)
 * ไม่มีไฟล์นี้ หน้าเว็บจะแสดงชื่อบริษัทเป็นตัวหนังสือแทน
 */
export const LOGO_URL = staticUrl('logo.png');

// ---------- จัดวางการ์ด ----------

/** ขนาดการ์ดแต่ละแบบ (px) ใช้ทั้งคำนวณตำแหน่งและสร้าง CSS จะได้ไม่ต้องแก้สองที่ */
const SIZE = {
  rule: { w: 320, h: 88 },
  chapter: { w: 280, h: 372 },
  link: { w: 190, h: 140 },
};
const GAP = { x: 44, y: 40 };
const MIN_RADIUS = 440;
/** แถวบนสุดกับล่างสุดห่างกันได้ไม่เกินกี่เรเดียน เกินนี้การ์ดริมจะเอนจนอ่านไม่ออก */
const MAX_SPAN = 1.9;
/** การ์ดแถวบนกับแถวล่างเอนตามผิวทรงกลมแค่บางส่วน มองจากด้านหน้าจะได้ยังอ่านออก */
const LEAN = 0.45;
const CHAPTERS_PER_ROW = 10;
const MAX_CHAPTER_ROWS = 3;
const PERSPECTIVE = 1500;

const round = (degrees) => Math.round(degrees * 100) / 100;

/**
 * วางการ์ดเป็นวงซ้อนกันบนผิวทรงกลม: กฎล่าสุดอยู่วงบน บทอยู่วงกลาง ทางลัดอยู่วงล่าง
 *
 * บททุกบทต้องได้การ์ดของตัวเองเสมอ บทเยอะขึ้นก็เพิ่มแถว (สูงสุด 3 แถว) แล้วขยายทรงกลมให้พอวาง
 * ส่วนกฎล่าสุดกับทางลัดเป็นของแถม วางได้เท่าที่วงนั้นมีที่เหลือ
 *
 * คืนตำแหน่งเป็นองศา lon = รอบแกนตั้ง (0 คือด้านหน้า) lat = สูงจากแนวกลางแค่ไหน tilt = หน้าการ์ดเงยขึ้นเท่าไร
 */
export function layoutScene(count) {
  const chapterRows = Math.min(MAX_CHAPTER_ROWS, Math.ceil(count.chapter / CHAPTERS_PER_ROW));
  const rows = [];
  if (count.rule > 0) rows.push({ kind: 'rule', n: count.rule });
  for (let i = 0, left = count.chapter; i < chapterRows; i++) {
    const n = Math.ceil(left / (chapterRows - i));
    rows.push({ kind: 'chapter', n, stagger: i % 2 === 1 });
    left -= n;
  }
  if (count.link > 0) rows.push({ kind: 'link', n: count.link });

  const arc = rows.reduce((sum, row) => sum + SIZE[row.kind].h, 0) + GAP.y * Math.max(0, rows.length - 1);
  const place = (radius) => {
    let top = arc / 2;
    for (const row of rows) {
      row.lat = (top - SIZE[row.kind].h / 2) / radius;
      top -= SIZE[row.kind].h + GAP.y;
    }
  };
  const room = (row, radius) => (2 * Math.PI * radius * Math.cos(row.lat)) / (SIZE[row.kind].w + GAP.x);

  // ขยายรัศมีจนแถวของบททุกแถววางได้ครบโดยไม่ซ้อนกัน (ขยับรัศมีแล้วมุมเงยเปลี่ยน จึงต้องวนซ้ำ)
  let radius = Math.max(MIN_RADIUS, arc / MAX_SPAN);
  for (let i = 0; i < 8; i++) {
    place(radius);
    const tightest = Math.min(...rows.filter((r) => r.kind === 'chapter').map((r) => room(r, radius) / r.n), 1);
    if (tightest >= 1) break;
    radius /= tightest;
  }
  place(radius);

  const spots = { rule: [], chapter: [], link: [] };
  for (const row of rows) {
    const n = row.kind === 'chapter' ? row.n : Math.min(row.n, Math.floor(room(row, radius)));
    const step = 360 / Math.max(1, n);
    // แถวสลับฟันปลากัน จะได้มองทะลุช่องว่างไปเห็นการ์ดด้านหลัง ยกเว้นแถวที่มีการ์ดน้อยให้ใบแรกอยู่ด้านหน้า
    const shift = row.kind === 'chapter' ? row.stagger : n >= 3;
    for (let i = 0; i < n; i++) {
      const lon = (((i + (shift ? 0.5 : 0)) * step + 180) % 360) - 180;
      const lat = (row.lat * 180) / Math.PI;
      spots[row.kind].push({ lon: round(lon), lat: round(lat), tilt: round(lat * LEAN) });
    }
  }

  return {
    radius: Math.round(radius),
    rings: rows.map((row) => round((row.lat * 180) / Math.PI)),
    ...spots,
  };
}

// ---------- ผ้าตัวอย่าง ----------

/**
 * สีย้อมโทนดิจิทัล แต่ละบทได้สามสี: สีสว่าง สีเข้ม และสีแซมที่ซึมเข้ามาจากมุม
 * เหมือนผ้าที่ย้อมสองสีแล้วสีไหลเข้าหากัน ใช้ซ้ำเมื่อครบรอบ
 */
const DYES = [
  ['#4cc2ff', '#1d4ed8', '#a78bfa'], // ฟ้าไฟฟ้า แซมม่วง
  ['#3fe0f0', '#0e7490', '#8f96ff'], // ไซแอน แซมคราม
  ['#a78bfa', '#5b21b6', '#7cecff'], // ม่วงไวโอเลต แซมฟ้า
  ['#34d8c0', '#0f766e', '#6da8ff'], // เขียวทีล แซมน้ำเงิน
  ['#e879f9', '#7e22ce', '#ffb3d9'], // ชมพูม่วง แซมชมพูอ่อน
  ['#6da8ff', '#3730a3', '#7cecff'], // น้ำเงินคราม แซมฟ้า
  ['#7cecff', '#2563eb', '#a78bfa'], // ฟ้าอะควา แซมม่วง
  ['#8f96ff', '#6d28d9', '#e879f9'], // ครามอมม่วง แซมชมพู
];
const WEAVES = 4;

/** attribute ของชิ้นผ้าตัวอย่างประจำบทที่ index (นับจาก 0) */
export const swatch = (index) => {
  const [light, deep, accent] = DYES[index % DYES.length];
  return `class="swatch weave-${index % WEAVES}" style="--c1:${light};--c2:${deep};--c3:${accent}"`;
};

/** ค่าสุ่มที่ได้เลขเดิมทุกครั้งสำหรับบทเดียวกัน ลายปกของแต่ละบทจึงไม่เปลี่ยนไปมาทุกครั้งที่เปิดหน้า */
const pick = (index, salt) => {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * ลายปกของการ์ดบท: ผืนผ้าพลิ้วซ้อนกันสามชั้น มีเส้นด้ายเรืองแสงพาดตามรอยพับ แต่ละบทพลิ้วไม่เหมือนกัน
 * วาดเป็น SVG ขนาด 256 × 138 (เท่ากับปกพอดี) ส่วน COVER_DEFS ต้องวางไว้ในหน้าหนึ่งครั้งเพื่อให้สีไล่ของรอยพับทำงาน
 */
export function cover(index) {
  const n = (value) => value.toFixed(1);
  const folds = [0, 1, 2].map((layer) => {
    const half = 52 + pick(index, layer) * 44; // ครึ่งช่วงคลื่น
    const lift = (16 + pick(index, layer + 10) * 16) * (pick(index, layer + 40) < 0.5 ? -1 : 1);
    const y = 50 + layer * 27 + pick(index, layer + 20) * 12;
    const x = -half * (0.4 + pick(index, layer + 30) * 1.4);
    const waves = `t${n(half)} 0`.repeat(Math.ceil((256 - x) / half));
    return { x, y, half, d: `M${n(x)} ${n(y)}q${n(half / 2)} ${n(lift)} ${n(half)} 0${waves}` };
  });
  const [top, middle] = folds;
  // ปมด้าย: จุดสว่างบนเส้นด้ายเส้นบน ค่อนไปทางขวา
  const knot = top.x + top.half * Math.max(1, Math.round((188 - top.x) / top.half));
  return `<svg class="folds" viewBox="0 0 256 138" preserveAspectRatio="none" aria-hidden="true">
        ${folds.map((fold) => `<path d="${fold.d}V138H-400Z"/>`).join('')}
        <path class="thread faint" d="${middle.d}"/>
        <path class="thread" d="${top.d}"/>
        <circle cx="${n(knot)}" cy="${n(top.y)}" r="2.6"/>
      </svg>`;
}

/** สีไล่ของรอยพับผ้า: สว่างที่สันแล้วจางลงด้านล่าง ปกทุกใบใช้ร่วมกัน */
export const COVER_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <linearGradient id="fold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".36"/>
      <stop offset=".45" stop-color="#fff" stop-opacity=".07"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs></svg>`;

const tile = (width, height, body) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>${body}</svg>`,
  )}")`;

const stroke = (d, width) =>
  `<path d='${d}' fill='none' stroke='#fff' stroke-opacity='.3' stroke-width='${width}' stroke-linecap='round'/>`;

// ---------- CSS ----------

// โทนสี Digital Transformation: น้ำเงิน ฟ้าไซแอน และม่วง บนพื้นขาวน้ำแข็ง (สว่าง) หรือกรมท่าเข้ม (มืด)
const DAY = `
  color-scheme: light;
  --bg: #eef3fb; --paper: #ffffff; --ink: #0b1b3a; --muted: #5a6a88; --line: #d5dff0;
  --accent: #1d4ed8; --accent-soft: #e1ebff; --warn: #9a5b00; --warn-soft: #fff0d2;
  --ok: #17694a; --ok-soft: #dcf5ea; --quote: #f0f5fd;
  --sky-a: #f8fbff; --sky-b: #d9e5f8; --vignette: rgba(40, 72, 140, .18);
  --dye-1: rgba(59, 130, 246, .34); --dye-2: rgba(139, 92, 246, .24);
  --dye-3: rgba(34, 211, 238, .34); --dye-4: rgba(45, 212, 191, .24);
  --glass: rgba(255, 255, 255, .58); --glass-dense: rgba(255, 255, 255, .92); --glass-near: rgba(255, 255, 255, .82); --glass-hi: rgba(255, 255, 255, .95);
  --glass-line: rgba(255, 255, 255, .92); --glass-shadow: rgba(30, 58, 120, .34);
  --on-glass: #0b1b3a; --on-glass-muted: #4a5a7a;
  --shine: #1d4ed8; --scrim: rgba(12, 28, 66, .32);
  --title-a: #0b1b3a; --title-b: #1d4ed8; --title-c: #6d28d9; --veil: rgba(255, 255, 255, .6);
  --logo: none;
  --thread: 37, 99, 235; --halo: .22; --blend: source-over;
`;

const NIGHT = `
  color-scheme: dark;
  --bg: #060b1a; --paper: #0e1730; --ink: #e8f0ff; --muted: #98a8c8; --line: #1f2c4f;
  --accent: #7dd3fc; --accent-soft: #12284a; --warn: #fbbf24; --warn-soft: #33280f;
  --ok: #6ee7b7; --ok-soft: #0f2f27; --quote: #111c3a;
  --sky-a: #0c1b42; --sky-b: #030611; --vignette: rgba(0, 0, 0, .6);
  --dye-1: rgba(37, 99, 235, .56); --dye-2: rgba(124, 58, 237, .4);
  --dye-3: rgba(6, 182, 212, .32); --dye-4: rgba(192, 38, 211, .22);
  --glass: rgba(11, 20, 48, .56); --glass-dense: rgba(9, 16, 40, .9); --glass-near: rgba(9, 16, 40, .8); --glass-hi: rgba(150, 200, 255, .16);
  --glass-line: rgba(140, 195, 255, .24); --glass-shadow: rgba(0, 0, 0, .7);
  --on-glass: #eaf2ff; --on-glass-muted: #a9b9d9;
  --shine: #67e8f9; --scrim: rgba(1, 3, 12, .52);
  --title-a: #ffffff; --title-b: #7dd8ff; --title-c: #c4b5fd; --veil: rgba(3, 6, 17, .55);
  --logo: brightness(0) invert(1) drop-shadow(0 0 10px rgba(103, 232, 249, .55));
  --thread: 103, 232, 249; --halo: .2; --blend: lighter;
`;

/**
 * โทนสีที่ล็อกไว้ให้ทุกเครื่องเห็นเหมือนกัน ทั้งหน้าหนังสือและหน้าผู้ดูแล: 'dark' หรือ 'light'
 * ถ้าเว้นว่าง ('') สีจะเปลี่ยนตามโหมดมืด/สว่างของแต่ละเครื่อง
 */
export const THEME = 'dark';

/** attribute ที่ต้องใส่ใน <html> ของทุกหน้าเพื่อให้โทนสีที่ล็อกไว้มีผล */
export const THEME_ATTR = THEME ? ` data-theme="${THEME}"` : '';

const sizes = Object.entries(SIZE)
  .map(([kind, { w, h }]) => `.is-${kind} { --w: ${w}px; --h: ${h}px; }`)
  .join('\n');

/**
 * ธีมที่ใช้ร่วมกันทั้งหน้าหนังสือและหน้าผู้ดูแล: สี ตัวอักษร พื้นหลังน้ำย้อม และชิ้นผ้าตัวอย่าง
 * ต้องวางต่อจาก STYLE ของ book.js เพราะทับค่าสีพื้นฐานในนั้น
 */
export const THEME_STYLE = `
/* ---------- ธีม: ขาวน้ำแข็ง (สว่าง) กับกรมท่าเข้ม (มืด) ---------- */
:root { ${DAY} }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { ${NIGHT} }
}
:root[data-theme="dark"] { ${NIGHT} }
/* ล็อกโหมดมืดไว้ก็ตาม ตอนพิมพ์ลงกระดาษต้องเป็นตัวหนังสือเข้มบนพื้นขาวเสมอ */
@media print {
  :root, :root[data-theme="dark"] { ${DAY} }
}

h1, h2, .wordmark { font-family: 'Trirong', 'Sarabun', serif; font-weight: 600; }
.eyebrow { letter-spacing: .12em; }
.wordmark { margin: 0; font-size: .92rem; font-weight: 500; letter-spacing: .36em; text-transform: uppercase; color: var(--shine); }
.wordmark::after {
  content: ''; display: block; width: 46px; height: 1px; margin: 10px 0 12px;
  background: linear-gradient(90deg, var(--shine), transparent);
}
/* โลโก้บริษัท ไฟล์เป็นสีน้ำเงินเข้มซึ่งกลืนกับพื้นมืด โทนมืดจึงกลับเป็นสีขาว (--logo)
   ส่วนโทนสว่างและตอนพิมพ์ใช้สีจริงของโลโก้ */
.logo { display: block; height: 40px; width: auto; filter: var(--logo); -webkit-user-drag: none; }
.cover .logo { height: 46px; margin-bottom: 22px; }

/* ---------- พื้นหลังน้ำย้อม ---------- */
.sky { background: radial-gradient(130% 100% at 50% 0%, var(--sky-a), var(--sky-b) 80%); }
/* น้ำย้อมสี่สีซึมเข้าหากัน */
.dyes {
  position: absolute; inset: -12%;
  background:
    radial-gradient(52% 50% at 16% 14%, var(--dye-1), transparent 72%),
    radial-gradient(44% 46% at 90% 36%, var(--dye-2), transparent 72%),
    radial-gradient(46% 42% at 28% 96%, var(--dye-3), transparent 72%),
    radial-gradient(40% 42% at 82% 92%, var(--dye-4), transparent 72%);
}
/* ลายเส้นยืนเส้นพุ่งบาง ๆ ให้พื้นหลังดูเป็นเนื้อผ้า */
.sky::after {
  content: ''; position: absolute; inset: 0;
  background:
    repeating-linear-gradient(0deg, rgba(255, 255, 255, .028) 0 1px, transparent 1px 4px),
    repeating-linear-gradient(90deg, rgba(0, 0, 0, .03) 0 1px, transparent 1px 4px),
    radial-gradient(120% 110% at 50% 46%, transparent 52%, var(--vignette));
}

/* ---------- ผ้าตัวอย่าง ---------- */
.swatch {
  position: relative; display: block; flex: none; overflow: hidden; border-radius: 16px; isolation: isolate;
  color: #fff; text-shadow: 0 2px 10px rgba(0, 0, 40, .35);
  /* สีย้อมสองสีซึมเข้าหากัน: สีแซมไหลมาจากมุมขวาบน สีเข้มจมอยู่มุมซ้ายล่าง */
  background:
    radial-gradient(95% 130% at 100% 0%, var(--c3), transparent 64%),
    radial-gradient(120% 120% at 0% 100%, var(--c2), transparent 72%),
    linear-gradient(150deg, var(--c1), var(--c2));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .24), inset 0 1px 0 rgba(255, 255, 255, .55);
}
/* ลายทอบาง ๆ ให้ยังรู้ว่าเป็นเนื้อผ้า */
.swatch::before {
  content: ''; position: absolute; inset: 0; z-index: -1;
  background: var(--weave); opacity: .22;
}
/* เงาวาวด้านบนกับเงาเข้มด้านล่าง ตัวเลขบนปกจะได้อ่านง่าย */
.swatch::after {
  content: ''; position: absolute; inset: 0; z-index: -1;
  background: linear-gradient(180deg, rgba(255, 255, 255, .12), transparent 34%, transparent 52%, rgba(0, 0, 50, .36));
}
/* ผืนผ้าพลิ้วบนปกการ์ดบท กับเส้นด้ายเรืองแสงตามรอยพับ */
.folds { position: absolute; inset: 0; width: 100%; height: 100%; }
.folds path { fill: url(#fold); }
.folds .thread { fill: none; stroke: rgba(255, 255, 255, .8); stroke-width: 1.1; filter: drop-shadow(0 0 3px rgba(255, 255, 255, .9)); }
.folds .faint { stroke: rgba(255, 255, 255, .3); stroke-width: .8; filter: none; }
.folds circle { fill: #fff; filter: drop-shadow(0 0 4px #fff); }
.weave-0 { --weave: ${tile(12, 10, stroke('M0 1l6 7 6-7', 2.2))}; } /* ผ้าถัก */
.weave-1 { --weave: ${tile(
  8,
  8,
  `<path d='M0 0h4v4H0zM4 4h4v4H4z' fill='#fff' fill-opacity='.16'/><path d='M4 0h4v4H4zM0 4h4v4H0z' fill-opacity='.1'/>`,
)}; } /* ลายขัด */
.weave-2 { --weave: ${tile(8, 8, stroke('M-2 6l8-8M2 10l8-8', 1.8))}; } /* ลายสอง */
.weave-3 { --weave: ${tile(16, 8, stroke('M0 8l8-8 8 8M0 4l4-4M12 0l4 4', 1.6))}; } /* ลายก้างปลา */

`;

export const SCENE_STYLE = `
.scene, .scrim, .bar, .finder { display: none; }

/* ---------- ฉาก ---------- */
.scene { position: fixed; inset: 0; overflow: hidden; color: var(--on-glass); }
.sky, .threads, .stage { position: absolute; inset: 0; }
.threads { width: 100%; height: 100%; pointer-events: none; }
.stage {
  perspective: ${PERSPECTIVE}px; perspective-origin: 50% 55%;
  touch-action: none; cursor: grab;
  -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
  animation: arrive 1.4s ease-out backwards;
}
.stage.dragging { cursor: grabbing; }
@keyframes arrive { from { opacity: 0; } }
.world { position: absolute; left: 50%; top: 55%; transform-style: preserve-3d; }
/* ตัวการ์ตูนกลางฉาก: รูปภาพบนแผ่นที่เท้าปักอยู่กลางวงแหวน สคริปต์หมุนแผ่นให้หันเข้าหากล้องเสมอ
   ค่อย ๆ ปรากฏเมื่อโหลดรูปเสร็จ แสงเรืองรอบตัวช่วยให้ตัวสีขาวไม่กลืนกับพื้นหลังสว่าง */
.figure {
  position: absolute; pointer-events: none; transform-origin: 50% 100%;
  opacity: 0; transition: opacity .7s;
}
.figure.on { opacity: 1; }
.figure img {
  display: block; width: 100%; height: 100%; transform-origin: 50% 100%;
  filter: drop-shadow(0 0 22px rgba(var(--thread), .4));
  animation: sway 5.2s ease-in-out infinite;
  -webkit-user-drag: none;
}
/* ขยับตัวเบา ๆ เหมือนยืนหายใจ */
@keyframes sway {
  0%, 100% { transform: rotate(-1.4deg) scaleY(1); }
  50% { transform: rotate(1.4deg) scaleY(1.015); }
}

/* ---------- การ์ดแก้ว ---------- */
${sizes}
.card {
  position: absolute; left: calc(var(--w) / -2); top: calc(var(--h) / -2);
  width: var(--w); height: var(--h); padding: 12px; border-radius: 26px;
  color: var(--on-glass); text-decoration: none; font-size: 14px; line-height: 1.5;
  background: linear-gradient(150deg, var(--glass-hi), transparent 38%) var(--glass);
  border: 1px solid var(--glass-line);
  box-shadow: 0 28px 60px -28px var(--glass-shadow);
  transform: rotateY(var(--lon)) rotateX(var(--lat)) translateZ(calc(var(--r) + var(--lift, 0px)))
    rotateX(calc(var(--tilt) - var(--lat)));
  transition: transform .45s cubic-bezier(.2, .8, .2, 1), filter .4s, border-color .3s, background-color .4s;
  -webkit-user-drag: none;
}
.card:focus-visible { outline: 2px solid var(--shine); outline-offset: 4px; }
/* การ์ดที่หันหลังให้กล้อง: กลับด้านเนื้อหาให้อ่านจากข้างหลังได้ แล้วเบลอให้ดูอยู่ไกล */
.card.back .face { transform: scaleX(-1); }
.card.far { filter: blur(2.4px); }
.dense .card.far { visibility: hidden; }
/* การ์ดที่หันมาด้านหน้าต้องอ่านออกแม้มีตัวการ์ตูนอยู่ข้างหลัง: จอสัมผัสใช้แก้วทึบขึ้นแต่ยังเห็นราง ๆ (เบา ไม่กินแรงเครื่อง)
   ส่วนเครื่องที่ใช้เมาส์เบลอฉากหลังจริง ๆ */
.card.near { background-color: var(--glass-near); }
@media (hover: hover) and (pointer: fine) {
  .card.near {
    background-color: var(--glass);
    -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3);
  }
  .card.near:hover { --lift: 26px; border-color: var(--shine); }
}
.face { display: flex; flex-direction: column; height: 100%; min-width: 0; }

.is-chapter .swatch { height: 138px; }
.swatch .no {
  position: absolute; left: 16px; bottom: 8px; font: 600 58px/1 'Trirong', serif; letter-spacing: -.01em;
  /* ตัวเลขไล่จากขาวสว่างลงไปขาวโปร่ง เงาต้องใช้ filter เพราะตัวอักษรโปร่งใสใช้ text-shadow ไม่ได้ */
  background: linear-gradient(180deg, #fff 38%, rgba(255, 255, 255, .7));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: none; filter: drop-shadow(0 3px 8px rgba(0, 0, 50, .45));
}
.swatch .tag {
  position: absolute; right: 12px; top: 12px; padding: 1px 11px; border-radius: 999px;
  font-size: 12px; font-weight: 600; text-shadow: none;
  background: rgba(255, 255, 255, .2); border: 1px solid rgba(255, 255, 255, .5);
}
.kicker {
  display: block; margin: 14px 6px 2px;
  font-size: 11.5px; font-weight: 600; letter-spacing: .16em; color: var(--shine);
}
.is-chapter .name {
  margin: 0 6px; font: 600 20px/1.35 'Trirong', 'Sarabun', serif; max-height: calc(2.7em - 2px);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.blurb {
  margin: 8px 6px 0; font-size: 13.5px; line-height: 1.55; color: var(--on-glass-muted);
  /* วรรณยุกต์ของบรรทัดที่ถูกตัดทิ้งจะโผล่เป็นจุดใต้บรรทัดสุดท้าย จึงตัดกล่องให้เตี้ยลงอีกนิด */
  max-height: calc(4.65em - 2px);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
}
.more {
  display: flex; justify-content: space-between;
  margin: auto 6px 2px; padding-top: 9px; border-top: 1px solid var(--glass-line);
  font-size: 12.5px; font-weight: 600; letter-spacing: .08em; color: var(--shine);
}
.sub { display: block; font-size: 12px; color: var(--on-glass-muted); }

.is-rule { border-radius: 22px; }
.is-rule .face { flex-direction: row; align-items: center; gap: 12px; }
.is-rule .swatch {
  width: 62px; height: 62px; border-radius: 14px;
  display: grid; place-items: center; font: 600 19px/1 'Trirong', serif;
}
.txt { display: block; min-width: 0; }
.is-rule .name, .is-rule .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.is-rule .name { display: block; font-size: 14.5px; font-weight: 600; }

.is-link { padding: 16px 18px; }
.big { display: flex; align-items: flex-end; height: 44px; font: 600 42px/1 'Trirong', serif; color: var(--shine); }
.big svg { width: 34px; height: 34px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.is-link .name { display: block; margin-top: auto; font-size: 14.5px; font-weight: 600; line-height: 1.35; }

/* ---------- ชื่อเล่มและปุ่มที่ลอยทับฉาก ---------- */
.hud {
  position: absolute; inset: 0; pointer-events: none;
  padding: max(22px, env(safe-area-inset-top)) 28px max(18px, env(safe-area-inset-bottom));
  display: flex; flex-direction: column; justify-content: space-between;
}
.hud a, .hud button { pointer-events: auto; }
/* ม่านจาง ๆ หลังหัวหน้า ชื่อเล่มจะได้ยังอ่านออกตอนการ์ดหมุนมาอยู่ข้างหลัง */
.hud::before {
  content: ''; position: absolute; left: 0; top: 0; width: min(980px, 100%); height: 300px;
  background: radial-gradient(100% 100% at 0% 0%, var(--veil), transparent 72%);
}
/* แถวแรกเป็นชื่อบริษัทกับปุ่ม ชื่อเล่มกับตัวเลขสรุปกินเต็มความกว้าง */
.top { position: relative; display: grid; grid-template-columns: 1fr auto; column-gap: 16px; align-items: start; }
.top h1, .facts { grid-column: 1 / -1; }
/* ชื่อบริษัท: ตัวใหญ่และสว่างกว่าในหน้าอื่น มีเส้นเรืองแสงขีดใต้ */
.hud .wordmark {
  font-size: 1.02rem; font-weight: 600; letter-spacing: .34em;
  text-shadow: 0 0 16px rgba(var(--thread), .7), 0 1px 3px var(--sky-b);
}
/* จอเตี้ยโลโก้ย่อลงตามความสูงจอ หัวหน้าจะได้ไม่ลงไปทับการ์ดแถวบน */
.hud .logo { height: clamp(34px, 5.4vh, 50px); }
.hud .wordmark::after {
  width: 132px; height: 2px; margin: 12px 0 14px; border-radius: 2px;
  background: linear-gradient(90deg, var(--shine), var(--title-c) 60%, transparent);
  box-shadow: 0 0 12px rgba(var(--thread), .8);
}
/* ชื่อเล่ม: ตัวใหญ่ หนา ไล่สี และเรืองแสง
   ตัวอักษรที่ไล่สีต้องโปร่งใส จึงใช้ text-shadow ไม่ได้ ให้เงาด้วย filter แทน
   justify-self ทำให้กล่องกว้างเท่าข้อความ สีจะได้ไล่ครบตลอดชื่อ
   ขนาดเต็มใช้ตั้งแต่จอกว้าง 1280px ขึ้นไป แคบกว่านั้นย่อลงเร็วกว่าความกว้างจอ บนมือถือชื่อเล่มจะได้จบในสองบรรทัด */
.hud h1 {
  justify-self: start; font-size: clamp(1.25rem, min(4.6vw - 9px, 6.2vh), 3.1rem); font-weight: 700; line-height: 1.16; text-wrap: balance;
  background: linear-gradient(100deg, var(--title-a) 15%, var(--title-b) 62%, var(--title-c));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 20px rgba(var(--thread), .45)) drop-shadow(0 2px 3px var(--sky-b));
}
/* ตัวเลขสรุปเป็นป้ายแก้วเรียงกัน */
.facts { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 0; font-size: .88rem; color: var(--on-glass-muted); }
.facts span {
  padding: 3px 13px 3px 11px; border-radius: 999px; white-space: nowrap;
  background: var(--glass); border: 1px solid var(--glass-line);
}
.facts b { margin-right: 3px; font-size: 1.02rem; color: var(--shine); }
.actions { display: flex; gap: 8px; }
.actions a, .hint {
  padding: 7px 16px; border-radius: 999px; font-size: .88rem; white-space: nowrap;
  color: var(--on-glass); text-decoration: none;
  background: var(--glass); border: 1px solid var(--glass-line);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
}
.actions a:hover { border-color: var(--shine); }
/* ปุ่มเปิดช่องค้นหา หน้าตาเป็นช่องกรอกข้อความ กดแล้วกล่องค้นหาจริงจะลอยขึ้นมา */
.find {
  display: flex; align-items: center; gap: 8px; min-width: 210px; padding: 7px 10px 7px 14px;
  border-radius: 999px; font: inherit; font-size: .88rem; text-align: left; white-space: nowrap; cursor: pointer;
  color: var(--on-glass-muted); background: var(--glass); border: 1px solid var(--glass-line);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
}
.find:hover { border-color: var(--shine); color: var(--on-glass); }
.find span { flex: 1; }
.find kbd {
  padding: 0 7px; border-radius: 6px; font: inherit; font-size: .74rem;
  border: 1px solid var(--glass-line); color: var(--on-glass-muted);
}
/* จอสัมผัสไม่มีคีย์บอร์ด ไม่ต้องบอกปุ่มลัด */
@media (hover: none) { .find kbd { display: none; } }
.find svg, .finder-bar svg, .btn svg {
  flex: none; width: 18px; height: 18px;
  fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round;
}
.hint { align-self: center; margin: 0; color: var(--on-glass-muted); transition: opacity .8s; }
.hint.gone { opacity: 0; }

/* ---------- แผ่นอ่านเนื้อหา (เฉพาะบนจอและเมื่อ JavaScript ทำงาน) ---------- */
@media screen {
  .js, .js body { height: 100%; overflow: hidden; }
  .js .scene { display: block; }
  .js .scrim {
    display: block; position: fixed; inset: 0; background: var(--scrim);
    opacity: 0; pointer-events: none; transition: opacity .45s;
  }
  .js.reading .scrim { opacity: 1; pointer-events: auto; }
  .js .reader {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(780px, 100%);
    display: flex; flex-direction: column; outline: 0;
    background: var(--bg); background: color-mix(in srgb, var(--bg) 88%, transparent);
    -webkit-backdrop-filter: blur(28px) saturate(1.4); backdrop-filter: blur(28px) saturate(1.4);
    border-left: 1px solid var(--glass-line);
    box-shadow: -40px 0 90px -40px var(--glass-shadow);
    transform: translateX(105%); visibility: hidden;
    transition: transform .55s cubic-bezier(.2, .8, .2, 1), visibility 0s .55s;
  }
  .js.reading .reader { transform: none; visibility: visible; transition-delay: 0s; }
  .js .bar {
    display: flex; align-items: center; gap: 6px; padding: 10px 14px;
    border-bottom: 1px solid var(--line);
  }
  .where { flex: 1; min-width: 0; margin: 0 6px; font-weight: 600; font-size: .95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .btn {
    display: grid; place-items: center; flex: none; width: 40px; height: 40px; padding: 0; border-radius: 50%;
    color: var(--ink); text-decoration: none; font: inherit; font-size: 1.25rem; line-height: 1; cursor: pointer;
    border: 1px solid var(--line); background: var(--paper);
  }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  /* ปุ่มก่อนหน้า/ถัดไปที่ไม่มีที่ให้ไป */
  a.btn:not([href]) { visibility: hidden; }

  /* ---------- กล่องค้นหา ---------- */
  .js .finder:not([hidden]) {
    display: flex; justify-content: center; align-items: flex-start;
    position: fixed; inset: 0; z-index: 5; padding: 11vh 12px 12px;
    background: var(--scrim);
    -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  }
  .finder-box {
    display: flex; flex-direction: column; width: min(680px, 100%); max-height: 100%; overflow: hidden;
    border-radius: 22px; background: var(--bg); border: 1px solid var(--glass-line);
    box-shadow: 0 40px 90px -30px var(--glass-shadow), 0 0 0 1px rgba(var(--thread), .14), 0 0 60px -20px rgba(var(--thread), .5);
  }
  .finder-bar {
    display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 18px;
    color: var(--shine); border-bottom: 1px solid var(--line);
  }
  /* ตัวอักษรต้องไม่เล็กกว่า 16px ไม่งั้น iPhone จะซูมหน้าเองตอนแตะช่อง */
  .finder-bar input {
    flex: 1; min-width: 0; padding: 6px 0; font: inherit; font-size: 1.05rem;
    color: var(--ink); background: none; border: 0; outline: 0;
  }
  .finder-bar input::placeholder { color: var(--muted); }
  .finder-bar input::-webkit-search-cancel-button { display: none; }
  .finder-note { margin: 0; padding: 10px 18px; font-size: .86rem; color: var(--muted); }
  .finder-list { list-style: none; margin: 0; padding: 0 8px 8px; overflow-y: auto; overscroll-behavior: contain; }
  .finder-list a { display: block; padding: 10px 12px; border-radius: 12px; color: var(--ink); text-decoration: none; }
  .finder-list a:hover, .finder-list a.on { background: var(--accent-soft); }
  .finder-list span { display: block; }
  .finder-list .kind { font-size: .76rem; font-weight: 600; letter-spacing: .04em; color: var(--accent); }
  .finder-list .name { font-weight: 600; }
  .finder-list .text { font-size: .9rem; line-height: 1.6; color: var(--muted); }
  .finder-list mark { padding: 0 1px; border-radius: 3px; color: var(--ink); background: rgba(var(--thread), .3); }
  /* ชิ้นที่เพิ่งกดมาจากผลค้นหา กะพริบขอบให้เห็นว่าอยู่ตรงไหน */
  .hit { border-radius: 10px; animation: hit 2.6s ease-out; }
  @keyframes hit {
    0%, 40% { box-shadow: 0 0 0 3px var(--shine), 0 0 28px rgba(var(--thread), .6); }
    100% { box-shadow: 0 0 0 3px transparent, 0 0 28px transparent; }
  }
  .js .sheet { flex: 1; overflow-y: auto; overscroll-behavior: contain; }
  .js .sheet main { max-width: none; padding: 28px 32px 96px; }
  .js .reader[data-view="one"] [data-sec]:not(.on) { display: none; }
  /* เปิดจากลิงก์ตรงแล้วเบราว์เซอร์เลื่อนไปที่หัวข้อเอง เว้นระยะไว้ไม่ให้ชิดแถบด้านบน */
  .js .sheet [data-sec] { scroll-margin-top: 28px; }
  .js .reader[data-view="one"] .chapter { margin-top: 0; padding-top: 0; border-top: 0; }

  /* จอกว้าง: เลื่อนฉากไปทางซ้ายให้ยังเห็นการ์ดอยู่ข้างแผ่นอ่าน */
  @media (min-width: 1280px) {
    .threads, .stage { transition: transform .55s cubic-bezier(.2, .8, .2, 1); }
    .js.reading .threads, .js.reading .stage { transform: translateX(-390px); }
  }
  @media (max-width: 640px) {
    .hud { padding-left: 18px; padding-right: 18px; }
    /* จอแคบ: หัวหน้ากินที่หลายบรรทัด จึงเลื่อนฉากลงให้พ้น (สคริปต์จะวางตำแหน่งจริงตามความสูงของหัวหน้าอีกที) */
    .stage { perspective-origin: 50% 58%; }
    .world { top: 58%; }
    .hud .wordmark { font-size: .82rem; letter-spacing: .26em; }
    /* จอแคบ: ชื่อบริษัทกับชื่อเล่มกินเต็มความกว้าง ปุ่มย้ายลงไปอยู่ใต้ตัวเลขสรุป */
    .top { grid-template-columns: 1fr; }
    .actions { order: 1; margin-top: 12px; }
    .actions a { padding: 6px 12px; font-size: .82rem; }
    .find { flex: 1; min-width: 0; padding: 6px 10px 6px 12px; font-size: .82rem; }
    /* กล่องค้นหาชิดขอบบน คีย์บอร์ดบนจอจะได้ไม่บังผลค้น */
    .js .finder:not([hidden]) { padding: 10px; }
    .hint { font-size: .78rem; }
    .js .sheet main { padding: 20px 18px 80px; }
  }
}
@media (prefers-reduced-motion: reduce) {
  .stage, .figure img { animation: none; }
  .card, .scrim, .threads, .stage, .js .reader { transition: none; }
}
`;

// ---------- สคริปต์ฝั่งเบราว์เซอร์ ----------

/**
 * ฟังก์ชันนี้ถูกแปลงเป็นข้อความแล้วฝังลงในหน้าเว็บ จึงห้ามอ้างถึงตัวแปรนอกฟังก์ชัน
 * เขียนเป็นฟังก์ชันจริงแทนข้อความยาว ๆ เพื่อให้ Node ตรวจไวยากรณ์ให้ตั้งแต่ตอนเปิดเซิร์ฟเวอร์
 */
function sceneClient() {
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const scene = stage && stage.parentElement;
  const world = $('world');
  const canvas = $('threads');
  const dyes = $('dyes');
  const reader = $('reader');
  const sheet = $('sheet');
  if (!stage || !reader) return;

  const RAD = Math.PI / 180;
  const P = parseFloat(getComputedStyle(stage).perspective) || 1500;
  const R = Number(stage.dataset.radius);
  const MAX_PITCH = 80;
  const AUTO = -4; // องศาต่อวินาทีตอนปล่อยให้หมุนเอง
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  const HOME_PITCH = -7; // มุมกล้องตอนเปิดหน้า มองลงเล็กน้อย
  // zoom = 1 คือระยะที่การ์ดด้านหน้าพอดีจอ
  const view = { yaw: 0, pitch: HOME_PITCH, zoom: 1 };
  const spin = { yaw: 0, pitch: 0 };
  let fitScale = 1;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let tween = null;
  let drag = null;
  let drift = 0;
  let idleUntil = 0;
  let hovering = false;
  let reading = false;
  let whole = false;
  let dirty = true;
  let raf = 0;
  let last = 0;

  const cards = [...world.querySelectorAll('.card')].map((el) => {
    const lon = Number(el.dataset.lon);
    const tilt = Number(el.dataset.tilt);
    // slack = การ์ดเอนน้อยกว่าผิวทรงกลมอยู่เท่าไร ใช้ตัดสินว่าตอนไหนกล้องเริ่มเห็นด้านหลังของการ์ด
    const slack = Math.cos((Number(el.dataset.lat) - tilt) * RAD);
    return { el, lon, tilt, slack, sin: Math.sin(tilt * RAD), cos: Math.cos(tilt * RAD), key: -1, opacity: -1 };
  });
  const cardOf = new Map(cards.map((card) => [card.el, card]));
  const chapterRows = new Set([...world.querySelectorAll('.is-chapter')].map((el) => el.dataset.lat)).size || 1;
  // การ์ดเยอะมากแล้ว ซ่อนใบที่อยู่ด้านหลังไปเลย มือถือจะได้ไม่ต้องวาดทุกใบพร้อมกัน
  world.classList.toggle('dense', cards.length > 36);
  const header = scene.querySelector('.top');
  // การ์ดตัวแทนของแต่ละแถว ใช้คำนวณว่าฉากสูงกินที่บนจอเท่าไร
  const rows = [...new Map(cards.map((card) => [card.el.dataset.lat, card.el])).values()].map((el) => ({
    lat: Number(el.dataset.lat) * RAD,
    lean: (Number(el.dataset.tilt) - Number(el.dataset.lat)) * RAD,
    half: el.offsetHeight / 2,
  }));

  /**
   * ขอบบนของแถวบนสุดและขอบล่างของแถวล่างสุดอยู่ห่างจากใจกลางฉากกี่จุดบนจอ เมื่อย่อฉากเป็น scale เท่า
   * คิดจากการ์ดที่หันมาด้านหน้าตรง ๆ ด้วยการแปลงชุดเดียวกับ CSS ของการ์ด
   */
  function span(scale) {
    const eye = R + P / scale; // ระยะจากตาถึงใจกลางฉาก
    const sp = Math.sin(HOME_PITCH * RAD);
    const cp = Math.cos(HOME_PITCH * RAD);
    let up = 0;
    let down = 0;
    for (const row of rows) {
      for (const edge of [-row.half, row.half]) {
        // เอนการ์ด -> ดันออกไปที่ผิวทรงกลม -> ยกขึ้นตามแถว -> ก้มกล้อง
        const y1 = edge * Math.cos(row.lean);
        const z1 = edge * Math.sin(row.lean) + R;
        const y2 = y1 * Math.cos(row.lat) - z1 * Math.sin(row.lat);
        const z2 = y1 * Math.sin(row.lat) + z1 * Math.cos(row.lat);
        const y = ((y2 * cp - z2 * sp) * P) / (eye - (y2 * sp + z2 * cp));
        up = Math.max(up, -y);
        down = Math.max(down, y);
      }
    }
    return { up, down };
  }

  // ---------- มุมมอง ----------

  function fit() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    const sample = world.querySelector('.is-chapter') || world.querySelector('.card');
    const w = (sample && sample.offsetWidth) || 280;
    const h = (sample && sample.offsetHeight) || 372;
    // บทมีหลายแถวก็ย่อลงให้เห็นครบทุกแถว จะได้เลือกบทไหนก็ได้โดยไม่ต้องเงยหรือก้มฉากก่อน
    const tall = chapterRows * h + (chapterRows - 1) * 40;
    // จอแคบย่อลงอีกนิด จะได้เห็นการ์ดสองใบที่ขนาบตัวการ์ตูนมากขึ้น
    const narrow = width < 640;
    const share = narrow ? 0.58 : 0.66;
    fitScale = clamp(Math.min((width * share) / w, (height * 0.47) / h, (height * 0.8) / tall), 0.6, 1.2);
    let centre = '';
    if (narrow && header) {
      // จอแคบ: หัวหน้ากินเต็มความกว้างจอ จึงย่อฉากให้พอดีกับที่ว่างระหว่างหัวหน้ากับป้ายคำแนะนำด้านล่าง
      // (ขนาดบนจอไม่ได้แปรตามอัตราย่อเป็นเส้นตรงเสียทีเดียว จึงคำนวณซ้ำสองสามรอบ) แล้ววางไว้กลางที่ว่างนั้น
      const head = header.getBoundingClientRect().bottom - stage.getBoundingClientRect().top + 14;
      const foot = height - 56;
      let size = span(fitScale);
      for (let i = 0; i < 3 && size.up + size.down > foot - head; i++) {
        fitScale = clamp((fitScale * (foot - head)) / (size.up + size.down), 0.6, 1.2);
        size = span(fitScale);
      }
      // บทเยอะจนฉากใหญ่เกินที่ว่าง ก็ให้แถวบนสุดเริ่มใต้หัวหน้าพอดี ส่วนที่ล้นลงไปด้านล่างลากหรือซูมออกดูได้
      const fits = size.up + size.down <= foot - head;
      centre = `${Math.round(fits ? (head + foot + size.up - size.down) / 2 : head + size.up)}px`;
    }
    world.style.top = centre;
    stage.style.perspectiveOrigin = centre && `50% ${centre}`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    touch();
  }

  function zoomBy(factor) {
    view.zoom = clamp(view.zoom * factor, 0.35 / fitScale, 1.9 / fitScale);
    touch();
  }

  function glide(to, ms) {
    if (still.matches) {
      Object.assign(view, to);
      tween = null;
    } else {
      tween = { from: { ...view }, to, start: performance.now(), ms };
    }
    touch();
  }

  /** หมุนฉากให้การ์ดใบนี้มาอยู่ตรงหน้า โดยหมุนไปทางที่ใกล้กว่า */
  function face(card) {
    const turn = ((((-card.lon - view.yaw) % 360) + 540) % 360) - 180;
    glide({ yaw: view.yaw + turn, pitch: clamp(-card.tilt - 3, -MAX_PITCH, MAX_PITCH) }, 750);
  }

  /** ผู้ใช้เพิ่งแตะฉาก หยุดหมุนเองไว้สักพัก */
  function rest() {
    drift = 0;
    idleUntil = performance.now() + 5000;
  }

  function touch() {
    dirty = true;
    kick();
  }

  function kick() {
    if (raf || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let moving = Boolean(drag);

    if (tween) {
      const t = clamp((now - tween.start) / tween.ms, 0, 1);
      const eased = 1 - (1 - t) ** 3;
      for (const k of Object.keys(tween.to)) view[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * eased;
      if (t === 1) tween = null;
      moving = dirty = true;
    } else if (!drag && !reading) {
      if (Math.abs(spin.yaw) + Math.abs(spin.pitch) > 1) {
        // แรงเหวี่ยงที่เหลือหลังปล่อยมือ
        view.yaw += spin.yaw * dt;
        view.pitch = clamp(view.pitch + spin.pitch * dt, -MAX_PITCH, MAX_PITCH);
        spin.yaw *= Math.exp(-dt * 3.2);
        spin.pitch *= Math.exp(-dt * 3.2);
        moving = dirty = true;
      } else if (!still.matches && !hovering && now > idleUntil) {
        drift += (AUTO - drift) * Math.min(1, dt * 1.5);
        view.yaw += drift * dt;
        dirty = true;
      }
    }

    // จุดแสงบนเส้นด้ายขยับอยู่ตลอด จึงต้องวาดใหม่ทุกเฟรม
    if (!still.matches && !reading) moving = dirty = true;
    if (dirty) render(now);
    if (moving) kick();
  }

  function render(now) {
    dirty = false;
    const depth = P - R - P / (fitScale * view.zoom);
    const eye = P - depth; // ระยะจากตาถึงใจกลางฉาก
    world.style.transform = `translateZ(${depth.toFixed(1)}px) rotateX(${view.pitch.toFixed(2)}deg) rotateY(${view.yaw.toFixed(2)}deg)`;

    const sp = Math.sin(view.pitch * RAD);
    const cp = Math.cos(view.pitch * RAD);
    for (const card of cards) {
      // nz = การ์ดหันเข้าหากล้องแค่ไหน (1 = ตรงหน้า, -1 = หันหลังอยู่ไกลสุด)
      const nz = -card.sin * sp + card.cos * Math.cos((view.yaw + card.lon) * RAD) * cp;
      const back = nz * eye < R * card.slack;
      const key = (back ? 1 : 0) | (nz < -0.25 ? 2 : 0) | (!back && nz > 0.6 ? 4 : 0);
      if (key !== card.key) {
        card.key = key;
        card.el.classList.toggle('back', back);
        card.el.classList.toggle('far', (key & 2) > 0);
        card.el.classList.toggle('near', (key & 4) > 0);
      }
      const t = clamp((nz + 0.9) / 1.25, 0, 1);
      const opacity = Math.round((0.36 + 0.64 * t * t * (3 - 2 * t)) * 25) / 25;
      if (opacity !== card.opacity) {
        card.opacity = opacity;
        card.el.style.opacity = opacity;
      }
    }

    dyes.style.transform = `translate3d(${(Math.sin(view.yaw * RAD) * 4).toFixed(2)}%, ${(view.pitch * 0.05).toFixed(2)}%, 0)`;
    draw(depth, now);
  }

  // ---------- เส้นในฉาก: ด้ายที่ร้อยการ์ด และวงแหวนที่พื้น ----------

  const ctx = canvas.getContext('2d');
  const BUCKETS = 6;
  const buckets = Array.from({ length: BUCKETS }, () => []);
  const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const mul = (a, b) => {
    const out = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[c + 3] + a[r * 3 + 2] * b[c + 6]);
    }
    return out;
  };

  /** เส้นวงรีแนวนอน เก็บเป็นจุด x, y, z เรียงต่อกัน จุดสุดท้ายซ้ำจุดแรกเพื่อปิดวง */
  function loop(cx, y, cz, rx, rz, n) {
    const pts = new Float32Array((n + 1) * 3);
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 2 * Math.PI;
      pts[i * 3] = cx + rx * Math.cos(t);
      pts[i * 3 + 1] = y;
      pts[i * 3 + 2] = cz + rz * Math.sin(t);
    }
    return pts;
  }

  // ด้ายที่ร้อยการ์ดแต่ละแถวไว้ด้วยกัน
  const lats = (stage.dataset.rings || '').split(',').filter(Boolean).map(Number);
  const threads = lats.map((lat) => {
    const r = R * 0.992 * Math.cos(lat * RAD);
    const y = -R * 0.992 * Math.sin(lat * RAD);
    return { r, y, pts: loop(0, y, 0, r, r, 96) };
  });

  // ตัวการ์ตูนยืนอยู่ในช่วงความสูงของแถวบท: ศีรษะอยู่ใต้แถวกฎล่าสุด เท้าอยู่เหนือแถวทางลัด
  // การ์ดสองแถวนั้นจึงไม่บังตัว มีแต่การ์ดบทที่หมุนผ่านหน้าไป
  const rowY = (selector) =>
    [...world.querySelectorAll(selector)].map((el) => -R * Math.sin(Number(el.dataset.lat) * RAD));
  const chapterY = rowY('.is-chapter');
  const ruleY = rowY('.is-rule');
  const linkY = rowY('.is-link');
  let HEAD = -R * 0.5;
  let FEET = R * 0.45;
  if (chapterY.length) {
    HEAD = ruleY.length ? ruleY[0] + 56 : Math.min(...chapterY) - 206;
    FEET = linkY.length ? linkY[0] - 78 : Math.max(...chapterY) + 206;
  }
  const TALL = FEET - HEAD;
  const MID = (HEAD + FEET) / 2;
  // วงแหวนบนพื้นใต้เท้า
  const floor = [0.3, 0.38, 0.46].map((r) => loop(0, FEET, 0, r * TALL, r * TALL, 96));

  let tone = { rgb: '103, 232, 249', halo: 0.2, blend: 'lighter' };
  function readTone() {
    const style = getComputedStyle(root);
    tone = {
      rgb: style.getPropertyValue('--thread').trim() || tone.rgb,
      halo: Number(style.getPropertyValue('--halo')) || tone.halo,
      blend: style.getPropertyValue('--blend').trim() || tone.blend,
    };
    touch();
  }

  /** วาดเส้น 3 มิติลงบนผืนผ้าใบพื้นหลัง เส้นที่อยู่ใกล้กล้องสว่างและหนากว่าเส้นที่อยู่ไกล */
  function strokeLines(lines, m, depth, look) {
    const ox = world.offsetLeft;
    const oy = world.offsetTop;
    for (const bucket of buckets) bucket.length = 0;
    for (const pts of lines) {
      let px = 0;
      let py = 0;
      let pz = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const z = m[6] * pts[i] + m[7] * pts[i + 1] + m[8] * pts[i + 2];
        const k = P / (P - z - depth);
        const x = ox + (m[0] * pts[i] + m[1] * pts[i + 1] + m[2] * pts[i + 2]) * k;
        const y = oy + (m[3] * pts[i] + m[4] * pts[i + 1] + m[5] * pts[i + 2]) * k;
        if (i > 0) {
          const b = clamp(Math.floor((((pz + z) / 2 + R) / (2 * R)) * BUCKETS), 0, BUCKETS - 1);
          buckets[b].push(px, py, x, y);
        }
        px = x;
        py = y;
        pz = z;
      }
    }
    for (let b = 0; b < BUCKETS; b++) {
      const t = b / (BUCKETS - 1);
      const segments = buckets[b];
      ctx.globalAlpha = look.far + (look.near - look.far) * t * t;
      ctx.lineWidth = look.thin + (look.thick - look.thin) * t;
      ctx.beginPath();
      for (let i = 0; i < segments.length; i += 4) {
        ctx.moveTo(segments[i], segments[i + 1]);
        ctx.lineTo(segments[i + 2], segments[i + 3]);
      }
      ctx.stroke();
    }
  }

  // ---------- ตัวการ์ตูนกลางฉาก ----------

  // เป็นรูปภาพบนแผ่นที่ตั้งอยู่กลางฉาก เท้าปักอยู่กลางวงแหวน และหันเข้าหากล้องเสมอ (รูปมีด้านเดียว จึงเห็นด้านหน้าทุกมุม)
  // แผ่นนี้อยู่ในฉาก 3 มิติเดียวกับการ์ด เบราว์เซอร์จึงเรียงให้เองว่าการ์ดใบไหนอยู่หน้าตัวการ์ตูน ใบไหนอยู่หลัง
  const figure = document.createElement('div');
  figure.className = 'figure';
  figure.setAttribute('aria-hidden', 'true');
  let figureWidth = 0;
  if (stage.dataset.mascot) {
    const picture = new Image();
    picture.alt = '';
    picture.draggable = false;
    picture.onload = () => {
      figureWidth = TALL * (picture.naturalWidth / picture.naturalHeight);
      figure.style.cssText = `width:${figureWidth}px;height:${TALL}px;left:${-figureWidth / 2}px;top:${HEAD}px`;
      figure.classList.add('on');
      touch();
    };
    // โหลดรูปไม่ได้ ฉากยังใช้ได้ตามปกติ แค่ไม่มีตัวการ์ตูน
    picture.onerror = () => figure.remove();
    picture.src = stage.dataset.mascot;
    figure.append(picture);
    world.prepend(figure);
  }

  function draw(depth, now) {
    const ox = world.offsetLeft;
    const oy = world.offsetTop;
    const turn = mul(rotX(view.pitch * RAD), rotY(view.yaw * RAD));
    // กลางตัวการ์ตูนหลังหมุนฉากแล้ว: สูงต่ำ (midY) ใกล้ไกล (midZ) และอัตราย่อ ณ จุดนั้น (k0)
    const midY = MID * turn[4];
    const midZ = MID * turn[7];
    const k0 = P / (P - midZ - depth);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = tone.blend;
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';

    // แสงเรืองหลังตัวการ์ตูน
    const glowRadius = TALL * k0 * 0.66;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
    glow.addColorStop(0, `rgba(${tone.rgb}, ${tone.halo})`);
    glow.addColorStop(1, `rgba(${tone.rgb}, 0)`);
    ctx.save();
    ctx.translate(ox, oy + midY * k0);
    ctx.scale(0.85, 1);
    ctx.fillStyle = glow;
    ctx.fillRect(-glowRadius, -glowRadius, glowRadius * 2, glowRadius * 2);
    ctx.restore();

    ctx.strokeStyle = ctx.fillStyle = `rgb(${tone.rgb})`;
    strokeLines(threads.map((thread) => thread.pts), turn, depth, { far: 0.05, near: 0.42, thin: 0.6, thick: 1 });
    strokeLines(floor, turn, depth, { far: 0.1, near: 0.7, thin: 0.6, thick: 1.1 });

    // แผ่นแสงใต้เท้า
    const pad = floor[0];
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    for (let i = 0; i < pad.length; i += 3) {
      const k = P / (P - (turn[6] * pad[i] + turn[7] * pad[i + 1] + turn[8] * pad[i + 2]) - depth);
      ctx.lineTo(
        ox + (turn[0] * pad[i] + turn[1] * pad[i + 1] + turn[2] * pad[i + 2]) * k,
        oy + (turn[3] * pad[i] + turn[4] * pad[i + 1] + turn[5] * pad[i + 2]) * k,
      );
    }
    ctx.fill();

    // เงาใต้เท้า ให้ดูว่าตัวการ์ตูนยืนอยู่บนพื้นจริง
    if (figureWidth) {
      const k = P / (P - FEET * turn[7] - depth);
      const reach = figureWidth * 0.34 * k;
      const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
      shade.addColorStop(0, 'rgba(3, 10, 36, .5)');
      shade.addColorStop(1, 'rgba(3, 10, 36, 0)');
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.translate(ox, oy + FEET * turn[4] * k);
      // พื้นเป็นวงกลม มองเฉียงจึงเห็นเป็นวงรี ยิ่งมองเกือบขนานพื้นยิ่งแบน
      ctx.scale(1, Math.max(0.06, Math.abs(turn[7])));
      ctx.fillStyle = shade;
      ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
      ctx.restore();
    }

    // จุดแสงวิ่งไปตามด้ายที่ร้อยการ์ด เหมือนข้อมูลที่ไหลอยู่ในสาย
    if (!still.matches) {
      threads.forEach((thread, i) => {
        for (const lap of [0, Math.PI]) {
          const t = now / 3400 + i * 1.9 + lap;
          const x0 = thread.r * Math.cos(t);
          const z0 = thread.r * Math.sin(t);
          const z = turn[6] * x0 + turn[7] * thread.y + turn[8] * z0;
          if (z < 0) continue;
          const k = P / (P - z - depth);
          ctx.globalAlpha = Math.min(1, 0.25 + z / R);
          ctx.beginPath();
          ctx.arc(
            ox + (turn[0] * x0 + turn[1] * thread.y + turn[2] * z0) * k,
            oy + (turn[3] * x0 + turn[4] * thread.y + turn[5] * z0) * k,
            2.4,
            0,
            2 * Math.PI,
          );
          ctx.fill();
        }
      });
    }

    figure.style.transform = `rotateY(${(-view.yaw).toFixed(2)}deg) rotateX(${(-view.pitch).toFixed(2)}deg)`;
  }

  // ---------- ลาก ซูม คีย์บอร์ด ----------

  const pointers = new Map();
  let pinch = 0;
  let suppressClick = false;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const dismissHint = () => $('hint') && $('hint').classList.add('gone');

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tween = null;
    spin.yaw = spin.pitch = 0;
    suppressClick = false;
    rest();
    if (pointers.size === 1) {
      drag = { id: e.pointerId, travel: 0, moved: false, at: e.timeStamp };
    } else {
      drag = null;
      pinch = spread();
      suppressClick = true;
    }
    touch();
  });

  stage.addEventListener('pointermove', (e) => {
    const point = pointers.get(e.pointerId);
    if (!point) {
      if (e.pointerType === 'mouse') hovering = Boolean(e.target.closest && e.target.closest('.card'));
      return;
    }
    const dx = e.clientX - point.x;
    const dy = e.clientY - point.y;
    point.x = e.clientX;
    point.y = e.clientY;

    if (pointers.size > 1) {
      const now = spread();
      if (pinch > 0) zoomBy(now / pinch);
      pinch = now;
      return;
    }
    if (!drag) return;
    drag.travel += Math.hypot(dx, dy);
    if (!drag.moved) {
      // ขยับนิดเดียวยังนับเป็นการแตะ ไม่ใช่การลาก
      if (drag.travel < 6) return;
      drag.moved = true;
      suppressClick = true;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
      dismissHint();
    }
    // ลากสุดความกว้างจอหมุนได้ราวครึ่งรอบ
    const perPx = clamp(170 / width, 0.14, 0.42);
    const dt = Math.max(8, e.timeStamp - drag.at) / 1000;
    drag.at = e.timeStamp;
    view.yaw += dx * perPx;
    view.pitch = clamp(view.pitch - dy * perPx, -MAX_PITCH, MAX_PITCH);
    spin.yaw = spin.yaw * 0.4 + ((dx * perPx) / dt) * 0.6;
    spin.pitch = spin.pitch * 0.4 + ((-dy * perPx) / dt) * 0.6;
    touch();
  });

  function release(e) {
    if (!pointers.delete(e.pointerId)) return;
    pinch = 0;
    if (drag && drag.id === e.pointerId) {
      stage.classList.remove('dragging');
      // หยุดมือก่อนปล่อย หรือไม่ได้ลากเลย = ไม่ต้องเหวี่ยงต่อ
      if (!drag.moved || still.matches || e.timeStamp - drag.at > 90) spin.yaw = spin.pitch = 0;
      drag = null;
    }
    rest();
    touch();
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('pointerleave', () => (hovering = false));

  // ลากแล้วปล่อยบนการ์ด ไม่ควรนับเป็นการกดเปิดการ์ด
  stage.addEventListener(
    'click',
    (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  world.addEventListener('click', (e) => {
    const card = cardOf.get(e.target.closest('.card'));
    if (!card) return;
    face(card);
    // การ์ดที่หันหลังอยู่ยังอ่านไม่ออกว่าเป็นเรื่องอะไร แตะครั้งแรกจึงแค่หมุนมาให้ดูก่อน
    if (card.key & 1) e.preventDefault();
  });

  // ไล่ด้วยปุ่ม Tab แล้วให้การ์ดที่โฟกัสอยู่หมุนมาด้านหน้า
  world.addEventListener('focusin', (e) => {
    const card = cardOf.get(e.target.closest('.card'));
    if (!card || !e.target.matches(':focus-visible')) return;
    rest();
    face(card);
  });

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      tween = null;
      rest();
      dismissHint();
      zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.035 : 0.001)));
    },
    { passive: false },
  );

  addEventListener('keydown', (e) => {
    if (finding) {
      // ช่องค้นหาเปิดอยู่: ปุ่มทั้งหมดเป็นของช่องค้นหา ยกเว้น Esc ที่ใช้ปิด
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFinder();
      }
      return;
    }
    // กด / หรือ Ctrl+K เพื่อค้นหา (ถ้าไม่ได้กำลังพิมพ์อยู่ในช่องอื่น)
    const typing = e.target.closest && e.target.closest('input, textarea, select');
    if (!typing && (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'))) {
      e.preventDefault();
      return openFinder();
    }
    if (e.key === 'Escape' && reading) return go('');
    if (reading || e.ctrlKey || e.metaKey || e.altKey) return;
    const turn = { ArrowLeft: [24, 0], ArrowRight: [-24, 0], ArrowUp: [0, 12], ArrowDown: [0, -12] }[e.key];
    if (turn) {
      e.preventDefault();
      rest();
      glide({ yaw: view.yaw + turn[0], pitch: clamp(view.pitch + turn[1], -MAX_PITCH, MAX_PITCH) }, 450);
    } else if (e.key === '+' || e.key === '=') {
      zoomBy(1.15);
    } else if (e.key === '-') {
      zoomBy(1 / 1.15);
    }
  });

  // ---------- แผ่นอ่านเนื้อหา ----------

  const order = [...new Set([...reader.querySelectorAll('[data-sec]')].map((el) => el.dataset.sec))];
  const head = (key) => reader.querySelector(`[data-sec="${key}"]`);
  let cameFrom = null;

  function link(el, key) {
    if (!key) return el.removeAttribute('href');
    el.href = `#${head(key).id}`;
    el.title = head(key).dataset.title || '';
  }

  /** เปิดอ่านส่วนที่ชื่อ key (ไม่ระบุ = ทั้งเล่ม) แล้วเลื่อนไปที่ target ถ้ามี */
  function open(key, target) {
    whole = !key;
    reader.dataset.view = key ? 'one' : 'all';
    for (const el of reader.querySelectorAll('[data-sec]')) el.classList.toggle('on', el.dataset.sec === key);
    const i = order.indexOf(key);
    link($('prev'), key ? order[i - 1] : null);
    link($('next'), key ? order[i + 1] : null);
    $('where').textContent = key ? head(key).dataset.title || '' : 'ทั้งเล่ม';

    if (!reading) {
      reading = true;
      cameFrom = document.activeElement;
      root.classList.add('reading');
      scene.inert = true;
    }
    sheet.scrollTop = 0;
    if (target && target !== head(key)) target.scrollIntoView({ block: 'start' });
    reader.focus({ preventScroll: true });
  }

  function close() {
    if (!reading) return;
    reading = whole = false;
    root.classList.remove('reading');
    scene.inert = false;
    if (cameFrom && cameFrom.focus) cameFrom.focus({ preventScroll: true });
    rest();
    touch();
  }

  /** ดูจาก # ใน URL ว่าต้องเปิดส่วนไหน ลิงก์ทุกอันในเล่มจึงใช้ได้เหมือนเดิม และปุ่มย้อนกลับพากลับมาที่ฉาก */
  function route() {
    const id = location.hash.slice(1);
    if (!id) return close();
    if (id === 'all') return open(null, null);
    const target = document.getElementById(id);
    const section = target && target.closest('[data-sec]');
    // ลิงก์ไปหากฎที่ถูกซ่อนจากเล่มจะหาไม่เจอ ปล่อยหน้าที่อ่านอยู่ไว้อย่างเดิม
    if (!section || !reader.contains(section)) return;
    // กำลังอ่านทั้งเล่มอยู่ก็เลื่อนไปหาเฉย ๆ ไม่ต้องตัดเหลือบทเดียว
    open(whole && reading ? null : section.dataset.sec, target);
  }

  function go(hash) {
    history.pushState(null, '', hash || location.pathname + location.search);
    route();
  }

  for (const id of ['close', 'scrim']) {
    $(id).addEventListener('click', (e) => {
      e.preventDefault();
      go('');
    });
  }
  addEventListener('hashchange', route);

  // ---------- ค้นหา ----------

  // ค้นจากเนื้อหาที่อยู่ในหน้าอยู่แล้ว ไม่ต้องถามเซิร์ฟเวอร์ ผลค้นแต่ละรายการคือชิ้นหนึ่งของเล่ม
  // (บท กฎ คำพูดต้นฉบับ ย่อหน้า หรือรายการ) กดแล้วเปิดแผ่นอ่านไปที่ชิ้นนั้น
  const finder = $('finder');
  const query = $('finder-input');
  const results = $('finder-list');
  const note = $('finder-note');
  const MAX_RESULTS = 40;
  let finding = false;
  let index = null;
  let shown = [];
  let picked = -1;
  let askedFrom = null;

  const tidy = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  /** รวบรวมสิ่งที่ค้นได้จากเนื้อหาในแผ่นอ่าน ทำครั้งเดียวตอนเปิดช่องค้นหาครั้งแรก */
  function buildIndex() {
    const entries = [];
    // weight = ลำดับความสำคัญเมื่อคำค้นตรงพอกัน (กฎ > บท > เนื้อหา) extra = ข้อความที่ค้นเจอได้แต่ไม่ต้องแสดง
    const add = (el, kind, name, text, weight, extra) => {
      const section = el.closest('[data-sec]');
      const anchor = el.closest('[id]');
      if (!section || !anchor || !section.contains(anchor)) return;
      const title = tidy(name);
      const body = tidy(text);
      if (!title && !body) return;
      entries.push({
        el,
        anchor,
        kind,
        title,
        body,
        weight,
        where: section.dataset.title || '',
        titleHay: title.toLowerCase(),
        hay: `${title} ${body} ${extra || ''}`.toLowerCase(),
      });
    };
    const textOf = (el, selector) => {
      const found = el.querySelector(selector);
      return found ? found.textContent : '';
    };
    const place = (el) => el.closest('[data-sec]').dataset.title;

    for (const section of reader.querySelectorAll('section.chapter')) {
      add(section.querySelector('h2') || section, 'บท', section.dataset.title, '', 2);
    }
    for (const rule of reader.querySelectorAll('article.rule')) {
      const name = `${textOf(rule, '.num')} ${textOf(rule, 'h4')}`;
      const kind = rule.classList.contains('retired') ? 'กฎที่เลิกใช้แล้ว' : 'กฎ';
      add(rule, kind, name, textOf(rule, '.summary'), 3, textOf(rule, '.rid'));
      // เอาเฉพาะคำพูดจริง ไม่รวมป้ายกำกับ ชื่อผู้สอน และวันที่
      for (const quote of rule.querySelectorAll('blockquote')) {
        const said = [...quote.querySelectorAll('p:not(.label)')].map((p) => p.textContent).join(' ');
        add(quote, 'คำพูดต้นฉบับ', name, said, 1);
      }
    }
    for (const el of reader.querySelectorAll('article.conflict')) add(el, 'ข้อขัดแย้ง', place(el), el.textContent, 1);
    const prose =
      '.overview p, .overview li, section.chapter > p:not(.eyebrow):not(.meta), section.chapter > ul > li, ' +
      'section.chapter > h3:not(.rules-heading)';
    for (const el of reader.querySelectorAll(prose)) add(el, 'เนื้อหา', place(el), el.textContent, 1);
    for (const el of reader.querySelectorAll('.gaps li')) add(el, 'สิ่งที่ยังไม่ชัด', place(el), el.textContent, 1);
    for (const el of reader.querySelectorAll('.howto li')) add(el, 'วิธีอ่านเล่มนี้', '', el.textContent, 1);
    return entries;
  }

  /** ตัดข้อความช่วงที่มีคำค้นมาแสดง ถ้าคำค้นตรงแค่ในชื่อ ก็แสดงต้นข้อความ */
  function excerpt(body, words) {
    const low = body.toLowerCase();
    const at = Math.min(Infinity, ...words.map((word) => low.indexOf(word)).filter((i) => i >= 0));
    let from = at === Infinity ? 0 : Math.max(0, at - 36);
    // ไม่เริ่มตัดที่สระบนล่างหรือวรรณยุกต์ ไม่งั้นจะได้เครื่องหมายลอย ๆ ไม่มีพยัญชนะ
    while (from > 0 && /[ัิ-ฺ็-๎]/.test(body[from])) from++;
    const to = Math.min(body.length, from + 132);
    return `${from > 0 ? '…' : ''}${body.slice(from, to)}${to < body.length ? '…' : ''}`;
  }

  /** ใส่ข้อความลงใน node โดยเน้นคำที่ตรงกับคำค้น สร้างเป็น text node ทั้งหมด ไม่แปลงเป็น HTML */
  function paint(node, text, mark) {
    text.split(mark).forEach((piece, i) => {
      if (!piece) return;
      if (i % 2 === 0) return node.append(piece);
      const hit = document.createElement('mark');
      hit.textContent = piece;
      node.append(hit);
    });
  }

  function search() {
    const words = tidy(query.value).toLowerCase().split(' ').filter(Boolean);
    results.textContent = '';
    shown = [];
    picked = -1;
    if (words.length === 0) {
      note.textContent = 'พิมพ์คำที่อยากหา ค้นได้ทั้งชื่อกฎ เนื้อหากฎ คำพูดต้นฉบับ และคำอธิบายในทุกบท';
      return;
    }
    // ต้องมีครบทุกคำ ผลที่คำค้นอยู่ในชื่อขึ้นก่อน ที่เหลือเรียงตามลำดับในเล่ม
    const found = index
      .filter((entry) => words.every((word) => entry.hay.includes(word)))
      .map((entry, i) => ({
        entry,
        i,
        score: entry.weight + (words.every((word) => entry.titleHay.includes(word)) ? 4 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
    if (found.length === 0) {
      note.textContent = `ไม่พบ "${tidy(query.value)}" ลองใช้คำที่สั้นลง หรือสะกดอีกแบบ`;
      return;
    }
    note.textContent =
      found.length > MAX_RESULTS
        ? `พบ ${found.length} รายการ แสดง ${MAX_RESULTS} รายการแรก`
        : `พบ ${found.length} รายการ`;

    const mark = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    shown = found.slice(0, MAX_RESULTS).map((hit) => hit.entry);
    shown.forEach((entry, i) => {
      const row = document.createElement('a');
      row.href = `#${entry.anchor.id}`;
      row.dataset.i = i;
      const line = (name, text, highlight) => {
        if (!text) return;
        const span = document.createElement('span');
        span.className = name;
        if (highlight) paint(span, text, mark);
        else span.textContent = text;
        row.append(span);
      };
      line('kind', entry.where && entry.where !== entry.title ? `${entry.kind} · ${entry.where}` : entry.kind);
      line('name', entry.title, true);
      line('text', excerpt(entry.body, words), true);
      const li = document.createElement('li');
      li.append(row);
      results.append(li);
    });
    pick(0);
  }

  function pick(i) {
    const rows = results.querySelectorAll('a');
    rows.forEach((row, n) => row.classList.toggle('on', n === i));
    picked = i;
    if (rows[i]) rows[i].scrollIntoView({ block: 'nearest' });
  }

  /** เปิดแผ่นอ่านไปที่ชิ้นที่ค้นเจอ กางส่วนที่พับไว้ แล้วกะพริบให้เห็นว่าอยู่ตรงไหน */
  function jump(entry) {
    closeFinder(false);
    go(`#${entry.anchor.id}`);
    for (let fold = entry.el.closest('details'); fold; fold = fold.parentElement.closest('details')) fold.open = true;
    if (entry.el !== entry.anchor) entry.el.scrollIntoView({ block: 'center' });
    entry.el.classList.remove('hit');
    void entry.el.offsetWidth; // ให้กะพริบซ้ำได้แม้เพิ่งกะพริบไป
    entry.el.classList.add('hit');
  }

  function openFinder() {
    if (finding || !finder) return;
    if (!index) index = buildIndex();
    finding = true;
    askedFrom = document.activeElement;
    finder.hidden = false;
    // ระหว่างค้นหา ของข้างหลังกดไม่ได้และไม่รับโฟกัส
    scene.inert = true;
    reader.inert = true;
    query.focus();
    query.select();
    search();
  }

  function closeFinder(restoreFocus = true) {
    if (!finding) return;
    finding = false;
    finder.hidden = true;
    scene.inert = reading;
    reader.inert = false;
    if (restoreFocus && askedFrom && askedFrom.focus) askedFrom.focus({ preventScroll: true });
  }

  if (finder) {
    for (const button of document.querySelectorAll('[data-find]')) button.addEventListener('click', openFinder);
    $('finder-close').addEventListener('click', () => closeFinder());
    // กดที่ฉากหลังนอกกล่องค้นหา = ปิด
    finder.addEventListener('click', (e) => {
      if (e.target === finder) closeFinder();
    });
    query.addEventListener('input', search);
    query.addEventListener('keydown', (e) => {
      const count = shown.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (count) pick((picked + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (shown[picked]) jump(shown[picked]);
      }
    });
    results.addEventListener('click', (e) => {
      const row = e.target.closest('a');
      if (!row) return;
      e.preventDefault();
      jump(shown[Number(row.dataset.i)]);
    });
    reader.addEventListener('animationend', (e) => {
      if (e.animationName === 'hit') e.target.classList.remove('hit');
    });
  }

  // ---------- เริ่มทำงาน ----------

  readTone();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTone);
  addEventListener('resize', fit);
  document.addEventListener('visibilitychange', kick);
  fit();
  // ฟอนต์ของชื่อเล่มโหลดเสร็จแล้วหัวหน้าอาจสูงไม่เท่าเดิม ต้องจัดฉากใหม่
  if (document.fonts) document.fonts.ready.then(fit);
  route();
  // เปิดมาให้การ์ดใบแรกเยื้องไปทางซ้ายและใบถัดไปอยู่ทางขวา จะได้เห็นตัวการ์ตูนที่ยืนอยู่กลางฉากเต็มตัว
  const firstRow = cards.filter((card) => card.el.matches('.is-chapter') && card.tilt === cards[0].tilt).length;
  const home = firstRow ? -Math.min(180 / firstRow, 38) : 0;
  view.yaw = home;
  if (!reading && !still.matches) {
    // ฉากหมุนเข้าหาผู้ชม
    view.yaw = home + 46;
    view.zoom = 0.7;
    glide({ yaw: home, zoom: 1 }, 1900);
  }
  setTimeout(dismissHint, 9000);
}

export const SCENE_SCRIPT = `(${sceneClient})();`;
