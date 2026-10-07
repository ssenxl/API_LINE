/**
 * ฉาก 3 มิติของหน้าหนังสือ
 *
 * การ์ดแก้วลอยเป็นวงรอบคนที่ยืนอยู่กลางฉาก (ร่างคนถักขึ้นจากเส้นด้ายเรืองแสง) ลากเพื่อหมุนดูได้รอบทิศ
 * แตะการ์ดแล้วเนื้อหาส่วนนั้นเลื่อนเข้ามาให้อ่าน
 * ใช้ CSS 3D กับ canvas ธรรมดา ไม่พึ่งไลบรารีภายนอก หน้าหนังสือจึงยังเป็น HTML ก้อนเดียวเหมือนเดิม
 *
 * ถ้าเบราว์เซอร์ปิด JavaScript หรือสั่งพิมพ์ ฉากนี้จะถูกซ่อน เหลือหนังสือเรียงต่อกันทั้งเล่มแบบเดิม
 *
 * ไฟล์นี้ยังเก็บธีม (สี ตัวอักษร พื้นหลังน้ำย้อม ผ้าตัวอย่าง) ที่หน้าผู้ดูแลใช้ร่วมด้วย ทั้งสองหน้าจะได้หน้าตาชุดเดียวกัน
 */

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

/** สีย้อมโทนดิจิทัล ไล่จากสว่างไปเข้มเหมือนผ้าที่จุ่มย้อม แต่ละบทได้สีของตัวเองและใช้ซ้ำเมื่อครบรอบ */
const DYES = [
  ['#4cc2ff', '#1d4ed8'], // ฟ้าไฟฟ้า
  ['#3fe0f0', '#0e7490'], // ไซแอน
  ['#a78bfa', '#5b21b6'], // ม่วงไวโอเลต
  ['#34d8c0', '#0f766e'], // เขียวทีล
  ['#e879f9', '#7e22ce'], // ชมพูม่วง
  ['#6da8ff', '#3730a3'], // น้ำเงินคราม
  ['#7cecff', '#2563eb'], // ฟ้าอะควา
  ['#8f96ff', '#6d28d9'], // ครามอมม่วง
];
const WEAVES = 4;

/** attribute ของชิ้นผ้าตัวอย่างประจำบทที่ index (นับจาก 0) */
export const swatch = (index) =>
  `class="swatch weave-${index % WEAVES}" style="--c1:${DYES[index % DYES.length][0]};--c2:${DYES[index % DYES.length][1]}"`;

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
  --thread: 103, 232, 249; --halo: .2; --blend: lighter;
`;

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

h1, h2, .wordmark { font-family: 'Trirong', 'Sarabun', serif; font-weight: 600; }
.eyebrow { letter-spacing: .12em; }
.wordmark { margin: 0; font-size: .92rem; font-weight: 500; letter-spacing: .52em; text-transform: uppercase; color: var(--shine); }
.wordmark::after {
  content: ''; display: block; width: 46px; height: 1px; margin: 10px 0 12px;
  background: linear-gradient(90deg, var(--shine), transparent);
}

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
  position: relative; display: block; flex: none; overflow: hidden; border-radius: 16px;
  color: #fff; text-shadow: 0 2px 10px rgba(0, 0, 0, .4);
  background:
    linear-gradient(118deg, transparent 30%, rgba(255, 255, 255, .28) 47%, transparent 62%),
    var(--weave),
    linear-gradient(168deg, var(--c1), var(--c2));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .2), inset 0 -34px 40px -24px rgba(0, 0, 0, .4);
}
/* รอยเย็บรอบชิ้นผ้า */
.swatch::after {
  content: ''; position: absolute; inset: 6px; border-radius: 11px;
  border: 1px dashed rgba(255, 255, 255, .55);
}
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
.scene, .scrim, .bar { display: none; }

/* ---------- ฉาก ---------- */
.scene { position: fixed; inset: 0; overflow: hidden; color: var(--on-glass); }
.sky, .threads, .stage { position: absolute; inset: 0; }
.threads { width: 100%; height: 100%; pointer-events: none; }
.stage {
  perspective: ${PERSPECTIVE}px; perspective-origin: 50% 52%;
  touch-action: none; cursor: grab;
  -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
  animation: arrive 1.4s ease-out backwards;
}
.stage.dragging { cursor: grabbing; }
@keyframes arrive { from { opacity: 0; } }
.world { position: absolute; left: 50%; top: 52%; transform-style: preserve-3d; }
/* คนที่ยืนอยู่กลางฉาก สคริปต์วาดและหมุนให้หันเข้าหากล้องเอง */
.figure { position: absolute; pointer-events: none; }

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
/* การ์ดที่หันมาด้านหน้าต้องอ่านออกแม้มีคนยืนอยู่ข้างหลัง: จอสัมผัสใช้แก้วทึบขึ้นแต่ยังเห็นคนราง ๆ (เบา ไม่กินแรงเครื่อง)
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
.swatch .no { position: absolute; left: 16px; bottom: 6px; font: 600 56px/1 'Trirong', serif; }
.swatch .tag {
  position: absolute; right: 13px; top: 13px; padding: 0 10px; border-radius: 999px;
  font-size: 12px; font-weight: 600; text-shadow: none;
  background: rgba(0, 0, 0, .3); border: 1px solid rgba(255, 255, 255, .4);
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
.is-rule .swatch::after { inset: 4px; border-radius: 10px; }
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
.hud a { pointer-events: auto; }
/* แถวแรกเป็นชื่อแบรนด์กับปุ่ม ชื่อเล่มกับตัวเลขสรุปกินเต็มความกว้าง จอแคบจะได้ไม่ตกบรรทัด */
.top { display: grid; grid-template-columns: 1fr auto; column-gap: 16px; align-items: start; }
.top h1, .facts { grid-column: 1 / -1; }
/* ชื่อเล่มต้องยังอ่านออกตอนการ์ดหมุนมาอยู่ข้างหลัง */
.wordmark, .hud h1, .facts { text-shadow: 0 0 5px var(--sky-b), 0 1px 20px var(--sky-b); }
.hud h1 { font-size: clamp(1.45rem, 3.2vw, 2.2rem); }
.facts { margin: 6px 0 0; font-size: .9rem; color: var(--on-glass-muted); }
.actions { display: flex; gap: 8px; }
.actions a, .hint {
  padding: 7px 16px; border-radius: 999px; font-size: .88rem; white-space: nowrap;
  color: var(--on-glass); text-decoration: none;
  background: var(--glass); border: 1px solid var(--glass-line);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
}
.actions a:hover { border-color: var(--shine); }
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
    display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%;
    color: var(--ink); text-decoration: none; font-size: 1.25rem; line-height: 1;
    border: 1px solid var(--line); background: var(--paper);
  }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn:not([href]) { visibility: hidden; }
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
    /* จอแคบ: เลื่อนฉากลงเล็กน้อยให้พ้นชื่อเล่มด้านบน */
    .stage { perspective-origin: 50% 55%; }
    .world { top: 55%; }
    .wordmark { font-size: .8rem; }
    .actions a { padding: 6px 12px; font-size: .82rem; }
    .hint { font-size: .78rem; }
    .js .sheet main { padding: 20px 18px 80px; }
  }
}
@media (prefers-reduced-motion: reduce) {
  .stage { animation: none; }
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

  // zoom = 1 คือระยะที่การ์ดด้านหน้าพอดีจอ
  const view = { yaw: 0, pitch: -7, zoom: 1 };
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

  // ---------- มุมมอง ----------

  function fit() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    const sample = world.querySelector('.is-chapter') || world.querySelector('.card');
    const w = (sample && sample.offsetWidth) || 280;
    const h = (sample && sample.offsetHeight) || 372;
    // บทมีหลายแถวก็ย่อลงให้เห็นครบทุกแถว จะได้เลือกบทไหนก็ได้โดยไม่ต้องเงยหรือก้มฉากก่อน
    const tall = chapterRows * h + (chapterRows - 1) * 40;
    // จอแคบย่อลงอีกนิด จะได้เห็นการ์ดสองใบที่ขนาบคนกลางฉากมากขึ้น
    const share = width < 640 ? 0.58 : 0.66;
    fitScale = clamp(Math.min((width * share) / w, (height * 0.47) / h, (height * 0.8) / tall), 0.6, 1.2);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    // แผ่นใสของตัวคนถูกย่อตามระยะกล้อง จึงใช้จุดภาพเท่าที่จะเห็นจริงบนจอ (เผื่อซูมเข้าอีกหน่อย)
    figureScale = clamp((dpr * 1.25 * P) / (R + P / fitScale), 0.4, 2.5);
    figure.width = Math.round(PLANE.w * figureScale);
    figure.height = Math.round(PLANE.h * figureScale);
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

    // แถบแสงบนตัวคนและจุดแสงบนเส้นด้ายขยับอยู่ตลอด จึงต้องวาดใหม่ทุกเฟรม
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

  // ---------- เส้นในฉาก: คนยืนกลางฉาก วงแหวนที่พื้น และด้ายที่ร้อยการ์ด ----------

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

  // ความสูงของคนวัดจากแถวการ์ด: ศีรษะอยู่ใต้แถวกฎล่าสุดพอดี (ไม่ให้การ์ดแถวบนบังหน้า) เท้าอยู่ต่ำกว่าแถวทางลัด
  const rowY = (selector) =>
    [...world.querySelectorAll(selector)].map((el) => -R * Math.sin(Number(el.dataset.lat) * RAD));
  const chapterY = rowY('.is-chapter');
  const ruleY = rowY('.is-rule');
  const linkY = rowY('.is-link');
  let HEAD = -R * 0.62;
  let FEET = R * 0.62;
  if (chapterY.length) {
    HEAD = ruleY.length ? ruleY[0] + 24 : Math.min(...chapterY) - 256;
    FEET = linkY.length ? linkY[0] + 110 : Math.max(...chapterY) + 246;
  }
  const TALL = FEET - HEAD;
  const MID = (HEAD + FEET) / 2;

  // รูปร่างคน: แต่ละส่วนคือท่อที่หน้าตัดเป็นวงรี ไล่จากบนลงล่าง ทุกค่าเป็นสัดส่วนของความสูง
  // [สูงจากพื้น, ห่างจากกลางตัว, เยื้องไปข้างหน้า, กว้างครึ่งหนึ่ง, หนาครึ่งหนึ่ง]
  const TRUNK = [
    [0.998, 0, 0, 0.008, 0.009],
    [0.99, 0, 0, 0.026, 0.03],
    [0.974, 0, 0, 0.043, 0.05],
    [0.95, 0, 0, 0.055, 0.063],
    [0.93, 0, 0, 0.057, 0.066],
    [0.905, 0, 0.002, 0.053, 0.062],
    [0.885, 0, 0.004, 0.044, 0.052],
    [0.872, 0, 0.004, 0.033, 0.038], // คาง
    [0.86, 0, 0, 0.028, 0.031], // คอ
    [0.846, 0, 0, 0.032, 0.034],
    [0.836, 0, 0, 0.06, 0.04], // บ่า
    [0.824, 0, 0, 0.09, 0.047], // ไหล่
    [0.79, 0, 0.004, 0.096, 0.06], // อก
    [0.73, 0, 0.004, 0.09, 0.062],
    [0.66, 0, 0, 0.077, 0.052], // เอว
    [0.61, 0, 0, 0.078, 0.053],
    [0.555, 0, 0, 0.09, 0.061], // สะโพก
    [0.51, 0, 0, 0.094, 0.063],
    [0.48, 0, 0, 0.086, 0.058],
    [0.466, 0, 0, 0.06, 0.048],
  ];
  const LEG = [
    [0.49, 0.047, 0, 0.044, 0.05],
    [0.4, 0.05, 0, 0.041, 0.047],
    [0.31, 0.051, 0, 0.032, 0.036],
    [0.27, 0.051, 0.002, 0.03, 0.034], // เข่า
    [0.2, 0.052, -0.004, 0.032, 0.038], // น่อง
    [0.11, 0.054, -0.002, 0.023, 0.027],
    [0.05, 0.055, 0, 0.019, 0.023], // ข้อเท้า
    [0.028, 0.056, 0.016, 0.023, 0.042], // หลังเท้า
    [0.004, 0.057, 0.024, 0.027, 0.056], // ฝ่าเท้า
  ];
  const ARM = [
    [0.826, 0.106, 0, 0.022, 0.03],
    [0.8, 0.116, 0, 0.027, 0.031], // หัวไหล่
    [0.71, 0.126, 0, 0.024, 0.027],
    [0.64, 0.132, -0.002, 0.021, 0.023], // ศอก
    [0.56, 0.138, 0.006, 0.02, 0.021],
    [0.49, 0.143, 0.014, 0.015, 0.017], // ข้อมือ
    [0.455, 0.145, 0.017, 0.014, 0.024], // มือ
    [0.41, 0.146, 0.019, 0.009, 0.017],
  ];
  const SLICE = 0.0125;
  const person = []; // เส้นทั้งหมดของตัวคน
  const slices = []; // เฉพาะเส้นแนวนอน พร้อมความสูง ใช้กับแถบแสงที่กวาดขึ้นตามตัว

  /** สร้างท่อหนึ่งส่วนของร่างกาย side = -1 ซ้าย, 1 ขวา, 0 กลางตัว */
  function limb(keys, side, n, ribs) {
    const rings = [];
    for (let y = keys[0][0]; y > keys[keys.length - 1][0] - SLICE / 2; y -= SLICE) {
      let k = 1;
      while (k < keys.length - 1 && keys[k][0] > y) k++;
      const a = keys[k - 1];
      const b = keys[k];
      const f = clamp((a[0] - y) / (a[0] - b[0]), 0, 1);
      const at = (i) => (a[i] + (b[i] - a[i]) * f) * TALL;
      const pts = loop(side * at(1), FEET - y * TALL, at(2), at(3), at(4), n);
      rings.push(pts);
      slices.push({ y, pts });
    }
    person.push(...rings);
    // เส้นตั้งเชื่อมวงแต่ละชั้น ให้เห็นเป็นผิวของตัวคน
    for (let r = 0; r < ribs; r++) {
      const i = Math.round((r / ribs) * n) * 3;
      const rib = new Float32Array(rings.length * 3);
      rings.forEach((ring, j) => rib.set(ring.subarray(i, i + 3), j * 3));
      person.push(rib);
    }
  }
  limb(TRUNK, 0, 28, 8);
  for (const side of [-1, 1]) {
    limb(LEG, side, 14, 4);
    limb(ARM, side, 12, 4);
  }
  // วงแหวนบนพื้นใต้เท้า
  const floor = [0.16, 0.22, 0.28].map((r) => loop(0, FEET, 0, r * TALL, r * TALL, 96));

  // ตัวคนวาดลงบนแผ่นใสที่ตั้งอยู่กลางฉากและหันเข้าหากล้องเสมอ
  // เบราว์เซอร์จึงเรียงให้เองว่าการ์ดใบไหนอยู่หน้าคน ใบไหนอยู่หลังคน
  const PLANE = { w: TALL * 0.62, h: TALL * 1.2 };
  const figure = document.createElement('canvas');
  figure.className = 'figure';
  figure.setAttribute('aria-hidden', 'true');
  figure.style.cssText = `width:${PLANE.w}px;height:${PLANE.h}px;left:${-PLANE.w / 2}px;top:${MID - PLANE.h / 2}px`;
  world.prepend(figure);
  const pen = figure.getContext('2d');
  let figureScale = 1; // จุดภาพของแผ่นใสต่อหนึ่งหน่วยของฉาก

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

  /**
   * วาดเส้น 3 มิติลงบนผืนผ้าใบ เส้นที่อยู่ใกล้กล้องสว่างและหนากว่าเส้นที่อยู่ไกล
   * frame บอกว่าผืนผ้าใบนี้วางอยู่ตรงไหน: จุดกลาง (cx, cy), อัตราย่อ s และ px = หนึ่งจุดบนจอเท่ากับกี่หน่วยของผืนนี้
   */
  function strokeLines(g, lines, m, frame, zFar, zNear, look) {
    for (const bucket of buckets) bucket.length = 0;
    for (const pts of lines) {
      let px = 0;
      let py = 0;
      let pz = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const z = m[6] * pts[i] + m[7] * pts[i + 1] + m[8] * pts[i + 2];
        const k = (P / (P - z - frame.depth)) * frame.s;
        const x = frame.cx + (m[0] * pts[i] + m[1] * pts[i + 1] + m[2] * pts[i + 2]) * k;
        const y = frame.cy + (m[3] * pts[i] + m[4] * pts[i + 1] + m[5] * pts[i + 2]) * k;
        if (i > 0) {
          const b = clamp(Math.floor((((pz + z) / 2 - zFar) / (zNear - zFar)) * BUCKETS), 0, BUCKETS - 1);
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
      g.globalAlpha = look.far + (look.near - look.far) * t * t;
      g.lineWidth = (look.thin + (look.thick - look.thin) * t) * frame.px;
      g.beginPath();
      for (let i = 0; i < segments.length; i += 4) {
        g.moveTo(segments[i], segments[i + 1]);
        g.lineTo(segments[i + 2], segments[i + 3]);
      }
      g.stroke();
    }
  }

  function draw(depth, now) {
    const ox = world.offsetLeft;
    const oy = world.offsetTop;
    const turn = mul(rotX(view.pitch * RAD), rotY(view.yaw * RAD));
    const back = { cx: ox, cy: oy, s: 1, px: 1, depth };
    // กลางตัวคนหลังหมุนฉากแล้ว: สูงต่ำ (midY) ใกล้ไกล (midZ) และอัตราย่อ ณ จุดนั้น (k0)
    const midY = MID * turn[4];
    const midZ = MID * turn[7];
    const k0 = P / (P - midZ - depth);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = tone.blend;
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';

    // แสงเรืองหลังตัวคน เป็นวงรีตั้ง
    const glowRadius = TALL * k0 * 0.56;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
    glow.addColorStop(0, `rgba(${tone.rgb}, ${tone.halo})`);
    glow.addColorStop(1, `rgba(${tone.rgb}, 0)`);
    ctx.save();
    ctx.translate(ox, oy + midY * k0);
    ctx.scale(0.6, 1.1);
    ctx.fillStyle = glow;
    ctx.fillRect(-glowRadius, -glowRadius, glowRadius * 2, glowRadius * 2);
    ctx.restore();

    ctx.strokeStyle = ctx.fillStyle = `rgb(${tone.rgb})`;
    strokeLines(ctx, threads.map((thread) => thread.pts), turn, back, -R, R, { far: 0.05, near: 0.42, thin: 0.6, thick: 1 });
    strokeLines(ctx, floor, turn, back, -R, R, { far: 0.1, near: 0.7, thin: 0.6, thick: 1.1 });

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

    // ตัวคน
    const plane = { cx: PLANE.w / 2, cy: PLANE.h / 2 - midY, s: 1 / k0, px: 1 / k0, depth };
    // มองจากมุมสูงหรือมุมต่ำ ศีรษะกับเท้าจะอยู่ใกล้ไกลจากกล้องต่างกันมากขึ้น
    const reach = TALL * (0.09 + 0.5 * Math.abs(Math.sin(view.pitch * RAD)));
    pen.setTransform(figureScale, 0, 0, figureScale, 0, 0);
    pen.clearRect(0, 0, PLANE.w, PLANE.h);
    pen.globalCompositeOperation = tone.blend;
    pen.lineCap = 'round';
    pen.strokeStyle = `rgb(${tone.rgb})`;
    strokeLines(pen, person, turn, plane, midZ - reach, midZ + reach, { far: 0.1, near: 0.8, thin: 0.5, thick: 1.15 });
    if (!still.matches) {
      // แถบแสงกวาดจากเท้าขึ้นศีรษะ เหมือนกำลังสแกนตัว
      const at = (now / 5200) % 1.2;
      const lit = slices.filter((slice) => Math.abs(slice.y - at) < SLICE * 0.8).map((slice) => slice.pts);
      strokeLines(pen, lit, turn, plane, midZ - reach, midZ + reach, { far: 0.5, near: 1, thin: 1.2, thick: 2 });
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

  // ---------- เริ่มทำงาน ----------

  readTone();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTone);
  addEventListener('resize', fit);
  document.addEventListener('visibilitychange', kick);
  fit();
  route();
  // เปิดมาให้การ์ดใบแรกเยื้องไปทางซ้ายและใบถัดไปอยู่ทางขวา จะได้เห็นคนที่ยืนอยู่กลางฉากเต็มตัว
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
