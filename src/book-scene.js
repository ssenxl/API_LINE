/**
 * ฉาก 3 มิติของหน้าหนังสือ
 *
 * การ์ดแก้วลอยเป็นวงรอบก้อนเส้นด้ายสีทอง ลากเพื่อหมุนดูได้รอบทิศ แตะการ์ดแล้วเนื้อหาส่วนนั้นเลื่อนเข้ามาให้อ่าน
 * ใช้ CSS 3D กับ canvas ธรรมดา ไม่พึ่งไลบรารีภายนอก หน้าหนังสือจึงยังเป็น HTML ก้อนเดียวเหมือนเดิม
 *
 * ถ้าเบราว์เซอร์ปิด JavaScript หรือสั่งพิมพ์ ฉากนี้จะถูกซ่อน เหลือหนังสือเรียงต่อกันทั้งเล่มแบบเดิม
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

/** สีย้อมธรรมชาติ ไล่จากอ่อนไปเข้มเหมือนผ้าที่จุ่มย้อม แต่ละบทได้สีของตัวเองและใช้ซ้ำเมื่อครบรอบ */
const DYES = [
  ['#5a72d6', '#1a2868'], // คราม
  ['#d0647a', '#761c36'], // ครั่ง
  ['#e9c063', '#a36a14'], // ขมิ้น
  ['#46ad94', '#0d5548'], // ใบหูกวาง
  ['#7b66a0', '#2a1f42'], // มะเกลือ
  ['#de9166', '#8a3b1f'], // ฝาง
  ['#479fc0', '#114a64'], // น้ำทะเล
  ['#aea35c', '#544c1f'], // เปลือกประดู่
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

const DAY = `
  --bg: #f3ede1; --paper: #fffdf8; --ink: #1c1e33; --muted: #6b6779; --line: #e2d8c4;
  --accent: #85651c; --accent-soft: #f1e6cc; --warn: #9a5b00; --warn-soft: #fbecd2;
  --ok: #2f6b3f; --ok-soft: #e1f0e4; --quote: #f6f0e4;
  --sky-a: #fbf7ee; --sky-b: #e6dac3; --vignette: rgba(120, 96, 52, .2);
  --dye-1: rgba(52, 76, 178, .34); --dye-2: rgba(190, 74, 98, .26);
  --dye-3: rgba(222, 170, 70, .4); --dye-4: rgba(40, 140, 122, .24);
  --glass: rgba(255, 255, 255, .56); --glass-dense: rgba(255, 253, 248, .9); --glass-hi: rgba(255, 255, 255, .92);
  --glass-line: rgba(255, 255, 255, .9); --glass-shadow: rgba(58, 46, 96, .32);
  --on-glass: #1c1e33; --on-glass-muted: #575469;
  --gold: #94701f; --scrim: rgba(40, 34, 60, .3);
  --thread: 158, 116, 34; --halo: .34; --blend: source-over;
`;

const NIGHT = `
  --bg: #0a0d20; --paper: #141936; --ink: #efe9dc; --muted: #a7a3b6; --line: #2a3055;
  --accent: #e0c080; --accent-soft: #2d2b3a; --warn: #f0b660; --warn-soft: #3a2c14;
  --ok: #8fcf9e; --ok-soft: #1e3324; --quote: #1b2145;
  --sky-a: #121838; --sky-b: #05070f; --vignette: rgba(0, 0, 0, .6);
  --dye-1: rgba(62, 88, 220, .5); --dye-2: rgba(176, 52, 96, .36);
  --dye-3: rgba(214, 160, 60, .26); --dye-4: rgba(30, 146, 130, .28);
  --glass: rgba(20, 25, 56, .56); --glass-dense: rgba(18, 22, 50, .9); --glass-hi: rgba(255, 255, 255, .15);
  --glass-line: rgba(255, 255, 255, .2); --glass-shadow: rgba(0, 0, 0, .7);
  --on-glass: #f4efe4; --on-glass-muted: #bab6c8;
  --gold: #dcb970; --scrim: rgba(2, 3, 10, .5);
  --thread: 236, 204, 134; --halo: .2; --blend: lighter;
`;

const sizes = Object.entries(SIZE)
  .map(([kind, { w, h }]) => `.is-${kind} { --w: ${w}px; --h: ${h}px; }`)
  .join('\n');

export const SCENE_STYLE = `
/* ---------- ธีมของหนังสือ: ผ้าไหมดิบ (สว่าง) กับครามกลางคืน (มืด) ---------- */
:root { ${DAY} }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { ${NIGHT} }
}
:root[data-theme="dark"] { ${NIGHT} }

.book h1, .book h2, .wordmark { font-family: 'Trirong', 'Sarabun', serif; font-weight: 600; }
.book .eyebrow { letter-spacing: .12em; }
.scene, .scrim, .bar { display: none; }

/* ---------- ฉาก ---------- */
.scene { position: fixed; inset: 0; overflow: hidden; color: var(--on-glass); }
.sky, .threads, .stage { position: absolute; inset: 0; }
.sky { background: radial-gradient(130% 100% at 50% 0%, var(--sky-a), var(--sky-b) 80%); }
/* น้ำย้อมสี่สีซึมเข้าหากัน ขยับตามมุมที่หมุนฉากเล็กน้อยให้รู้สึกว่ามีความลึก */
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
.card:focus-visible { outline: 2px solid var(--gold); outline-offset: 4px; }
/* การ์ดที่หันหลังให้กล้อง: กลับด้านเนื้อหาให้อ่านจากข้างหลังได้ แล้วเบลอให้ดูอยู่ไกล */
.card.back .face { transform: scaleX(-1); }
.card.far { filter: blur(2.4px); }
.dense .card.far { visibility: hidden; }
/* การ์ดที่หันมาด้านหน้าต้องอ่านออกแม้มีเส้นด้ายอยู่ข้างหลัง: จอสัมผัสใช้แก้วทึบขึ้น (เบา ไม่กินแรงเครื่อง)
   ส่วนเครื่องที่ใช้เมาส์เบลอฉากหลังจริง ๆ */
.card.near { background-color: var(--glass-dense); }
@media (hover: hover) and (pointer: fine) {
  .card.near {
    background-color: var(--glass);
    -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3);
  }
  .card.near:hover { --lift: 26px; border-color: var(--gold); }
}
.face { display: flex; flex-direction: column; height: 100%; min-width: 0; }

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

.is-chapter .swatch { height: 138px; }
.swatch .no { position: absolute; left: 16px; bottom: 6px; font: 600 56px/1 'Trirong', serif; }
.swatch .tag {
  position: absolute; right: 13px; top: 13px; padding: 0 10px; border-radius: 999px;
  font-size: 12px; font-weight: 600; text-shadow: none;
  background: rgba(0, 0, 0, .3); border: 1px solid rgba(255, 255, 255, .4);
}
.kicker {
  display: block; margin: 14px 6px 2px;
  font-size: 11.5px; font-weight: 600; letter-spacing: .16em; color: var(--gold);
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
  font-size: 12.5px; font-weight: 600; letter-spacing: .08em; color: var(--gold);
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
.big { display: flex; align-items: flex-end; height: 44px; font: 600 42px/1 'Trirong', serif; color: var(--gold); }
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
.wordmark { margin: 0; font-size: .92rem; font-weight: 500; letter-spacing: .52em; text-transform: uppercase; color: var(--gold); }
.wordmark::after {
  content: ''; display: block; width: 46px; height: 1px; margin: 10px 0 12px;
  background: linear-gradient(90deg, var(--gold), transparent);
}
.hud h1 { font-size: clamp(1.45rem, 3.2vw, 2.2rem); }
.facts { margin: 6px 0 0; font-size: .9rem; color: var(--on-glass-muted); }
.actions { display: flex; gap: 8px; }
.actions a, .hint {
  padding: 7px 16px; border-radius: 999px; font-size: .88rem; white-space: nowrap;
  color: var(--on-glass); text-decoration: none;
  background: var(--glass); border: 1px solid var(--glass-line);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
}
.actions a:hover { border-color: var(--gold); }
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
  let ballTurn = 0;

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
    fitScale = clamp(Math.min((width * 0.66) / w, (height * 0.47) / h, (height * 0.8) / tall), 0.6, 1.2);
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

    if (!still.matches && !reading) {
      ballTurn += dt * 0.14;
      moving = dirty = true;
    }
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
    drawThreads(depth, now);
  }

  // ---------- เส้นด้าย ----------

  const ctx = canvas.getContext('2d');
  const STEPS = 72;
  const BUCKETS = 6;
  const circle = [];
  for (let i = 0; i <= STEPS; i++) {
    circle.push(Math.cos((i / STEPS) * 2 * Math.PI), Math.sin((i / STEPS) * 2 * Math.PI));
  }
  const buckets = Array.from({ length: BUCKETS }, () => []);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const apply = (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
  const mul = (a, b) => {
    const out = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[c + 3] + a[r * 3 + 2] * b[c + 6]);
    }
    return out;
  };

  // เส้นด้ายแต่ละเส้นคือวงกลม: จุดบนเส้น = c + u·cos t + v·sin t
  // ก้อนด้ายกลางฉาก: พันเป็นมัด มัดละหลายเส้นขนานกัน แกนของแต่ละมัดกระจายรอบลูกไม่ให้ซ้อนกัน
  const ballRadius = R * 0.56;
  const ball = [];
  const BANDS = 7;
  for (let b = 0; b < BANDS; b++) {
    const polar = Math.acos(1 - (b + 0.5) / BANDS);
    const around = b * 2.39996;
    const axis = [Math.sin(polar) * Math.cos(around), Math.cos(polar), Math.sin(polar) * Math.sin(around)];
    const side = cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    const u = scale(side, 1 / Math.hypot(side[0], side[1], side[2]));
    const v = cross(axis, u);
    for (let s = -1.5; s <= 1.5; s++) {
      const offset = s * 0.055 * ballRadius;
      const r = Math.sqrt(ballRadius * ballRadius - offset * offset);
      ball.push({ c: scale(axis, offset), u: scale(u, r), v: scale(v, r) });
    }
  }
  // ด้ายที่ร้อยการ์ดแต่ละแถวไว้ด้วยกัน
  const rings = (stage.dataset.rings || '')
    .split(',')
    .filter(Boolean)
    .map((lat) => {
      const r = R * 0.992 * Math.cos(lat * RAD);
      return { c: [0, -R * 0.992 * Math.sin(lat * RAD), 0], u: [r, 0, 0], v: [0, 0, r] };
    });

  let tone = { rgb: '236, 204, 134', halo: 0.2, blend: 'lighter' };
  function readTone() {
    const style = getComputedStyle(root);
    tone = {
      rgb: style.getPropertyValue('--thread').trim() || tone.rgb,
      halo: Number(style.getPropertyValue('--halo')) || tone.halo,
      blend: style.getPropertyValue('--blend').trim() || tone.blend,
    };
    touch();
  }

  function drawThreads(depth, now) {
    const ox = world.offsetLeft;
    const oy = world.offsetTop;
    const turn = mul(rotX(view.pitch * RAD), rotY(view.yaw * RAD));
    const project = (p) => {
      const k = P / (P - p[2] - depth);
      return [ox + p[0] * k, oy + p[1] * k];
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = tone.blend;
    ctx.globalAlpha = 1;

    // แสงเรือง ๆ หลังก้อนด้าย
    const glowRadius = ballRadius * (P / (P - depth)) * 2.2;
    const glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, glowRadius);
    glow.addColorStop(0, `rgba(${tone.rgb}, ${tone.halo})`);
    glow.addColorStop(1, `rgba(${tone.rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(ox - glowRadius, oy - glowRadius, glowRadius * 2, glowRadius * 2);

    ctx.strokeStyle = `rgb(${tone.rgb})`;
    ctx.lineCap = 'round';
    weave(rings, turn, R, { far: 0.05, near: 0.42, thin: 0.6, thick: 1 });
    const ballMatrix = mul(turn, mul(rotX(0.42), rotY(ballTurn)));
    weave(ball, ballMatrix, ballRadius, { far: 0.1, near: 0.9, thin: 0.6, thick: 1.3 });

    // ประกายแสงวิ่งไปตามเส้นด้าย
    if (!still.matches) {
      ctx.fillStyle = `rgb(${tone.rgb})`;
      for (let i = 0; i < ball.length; i += 4) {
        const t = now / 2600 + i * 1.7;
        const s = ball[i];
        const p = apply(ballMatrix, [
          s.c[0] + s.u[0] * Math.cos(t) + s.v[0] * Math.sin(t),
          s.c[1] + s.u[1] * Math.cos(t) + s.v[1] * Math.sin(t),
          s.c[2] + s.u[2] * Math.cos(t) + s.v[2] * Math.sin(t),
        ]);
        if (p[2] < 0) continue;
        const [x, y] = project(p);
        ctx.globalAlpha = p[2] / ballRadius;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    function weave(strands, m, radius, look) {
      for (const bucket of buckets) bucket.length = 0;
      for (const strand of strands) {
        const c = apply(m, strand.c);
        const u = apply(m, strand.u);
        const v = apply(m, strand.v);
        let px = 0;
        let py = 0;
        let pz = 0;
        for (let i = 0; i <= STEPS; i++) {
          const cs = circle[i * 2];
          const sn = circle[i * 2 + 1];
          const z = c[2] + u[2] * cs + v[2] * sn;
          const k = P / (P - z - depth);
          const x = ox + (c[0] + u[0] * cs + v[0] * sn) * k;
          const y = oy + (c[1] + u[1] * cs + v[1] * sn) * k;
          if (i > 0) {
            const b = clamp(Math.floor(((pz + z) / (4 * radius) + 0.5) * BUCKETS), 0, BUCKETS - 1);
            buckets[b].push(px, py, x, y);
          }
          px = x;
          py = y;
          pz = z;
        }
      }
      // ด้ายด้านหน้าสว่างและหนากว่าด้านหลัง
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
  if (!reading && !still.matches) {
    // เปิดมาให้ฉากหมุนเข้าหาผู้ชม
    view.yaw = 46;
    view.zoom = 0.7;
    glide({ yaw: 0, zoom: 1 }, 1900);
  }
  setTimeout(dismissHint, 9000);
}

export const SCENE_SCRIPT = `(${sceneClient})();`;
