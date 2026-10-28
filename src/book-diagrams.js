/**
 * ผังในหนังสือ
 *
 * - ผังขั้นตอนของแต่ละบท สลับดูได้สองแบบ: "ทีละขั้น" (บนลงล่าง) กับ "แยกตามฝ่าย" (swimlane)
 * - หน้า "ภาพรวมทั้งเล่ม" สลับดูได้สองแบบ: "แผนผังความคิด" (บทแตกกิ่งรอบหนังสือ) กับ "วงโคจร" (บทโคจรรอบมาสคอต)
 *
 * ทุกผังวาดเป็น SVG ฝั่งเซิร์ฟเวอร์ ไม่ต้องโหลดไลบรารี เปิดได้แม้ปิด JavaScript และสั่งพิมพ์ได้
 * ข้อมูลที่ใช้วาด (ขั้นตอน ชื่อสั้น และกฎต่างบทที่เกี่ยวข้องกัน) มาจาก AI ใน brain.js ไฟล์นี้แค่จัดวาง
 * สีทั้งหมดอ้างตัวแปรของธีม ผังจึงเปลี่ยนเป็นโทนสว่างเองตอนสั่งพิมพ์
 */
import { MASCOT_URL, dye } from './book-scene.js';

// ---------- ตัวช่วยข้อความ ----------

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const num = (value) => Math.round(value * 10) / 10;

// นับตัวอักษรแบบที่ตาเห็น สระบนล่างกับวรรณยุกต์ไม่นับแยก ความกว้างของข้อความไทยจะได้ประมาณใกล้ความจริง
const GRAPHEMES = new Intl.Segmenter('th', { granularity: 'grapheme' });
const WORDS = new Intl.Segmenter('th', { granularity: 'word' });
const glyphsOf = (value) => [...GRAPHEMES.segment(value)].map((g) => g.segment);

/** ตัดข้อความให้ยาวไม่เกิน n ตัวอักษร ถ้าตัดจะลงท้ายด้วย … */
export function clip(value, n) {
  const glyphs = glyphsOf(String(value ?? '').trim());
  return glyphs.length <= n ? glyphs.join('') : `${glyphs.slice(0, n - 1).join('').trimEnd()}…`;
}

/** ตัดข้อความเป็นบรรทัดตามคำ (ภาษาไทยไม่มีเว้นวรรค จึงใช้ตัวตัดคำของเบราว์เซอร์/Node) */
export function wrap(value, perLine, maxLines) {
  const lines = [];
  let line = '';
  for (const { segment } of WORDS.segment(String(value ?? '').replace(/\s+/g, ' ').trim())) {
    // เครื่องหมายอย่าง ? % ) ติดไปกับคำหน้าเสมอ ยอมให้เกินบรรทัดนิดหน่อยดีกว่าขึ้นบรรทัดใหม่มาตัวเดียว
    const mark = /^[?!.,:;%)\]}…]+$/.test(segment);
    if (!line.trim() || mark || glyphsOf(line + segment).length <= perLine) {
      line += segment;
    } else {
      lines.push(line.trim());
      line = segment.trimStart();
    }
  }
  if (line.trim()) lines.push(line.trim());
  // เผื่อ 2 ตัวให้เครื่องหมายที่ติดท้ายคำ ไม่งั้นจะโดนตัดเป็น … ทั้งที่เหลือแค่ ?
  const fitted = lines.map((l) => clip(l, perLine + 2));
  if (fitted.length <= maxLines) return fitted.length ? fitted : [''];
  const kept = fitted.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = last.endsWith('…') ? last : clip(`${last}…`, perLine);
  return kept;
}

/**
 * ใส่จุดที่ตัดบรรทัดได้ระหว่างคำ ใช้กับข้อความ HTML ที่ห้ามตัดกลางคำ (CSS word-break: keep-all)
 * ไม่ตัดหลังวงเล็บเปิดหรือก่อนวงเล็บปิด/เครื่องหมายวรรคตอน "(QC)" จะได้อยู่บรรทัดเดียวกัน
 */
const breakable = (value) =>
  [...WORDS.segment(String(value ?? ''))]
    .map((w) => w.segment)
    .reduce((html, word, i, words) => {
      const glue = i === 0 || /[([{]$/.test(words[i - 1]) || /^[)\]}.,:;!?]/.test(word);
      return html + (glue ? '' : '<wbr>') + esc(word);
    }, '');

/** ข้อความใน SVG หลายบรรทัด จัดให้กึ่งกลางของกลุ่มบรรทัดอยู่ที่ y */
function svgText(x, y, lines, cls, size, { anchor = 'middle', weight = 500, lh = Math.round(size * 1.3) } = {}) {
  const top = y - ((lines.length - 1) * lh) / 2;
  const spans = lines.map((line, i) => `<tspan x="${num(x)}"${i ? ` dy="${lh}"` : ''}>${esc(line)}</tspan>`).join('');
  return `<text class="${cls}" x="${num(x)}" y="${num(top)}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="central">${spans}</text>`;
}

/** เส้นลูกศร tone: a = ทางหลัก, v = ออกจากจุดตัดสินใจ, w = จุดที่กฎยังไม่บอก, o = ไปสู่ตอนจบ */
const arrow = (d, tone) => `<path class="dg-ln dg-ln-${tone}" d="${d}" marker-end="url(#dg-m-${tone})"/>`;

/** สีสว่างประจำบท ใช้เป็นสีเส้นและป้ายของบทนั้น */
const tint = (chapterIndex) => dye(chapterIndex)[0];

// ---------- ข้อมูลกลางที่ผังทุกแบบใช้ ----------

/**
 * รวมสิ่งที่ผังทุกแบบต้องใช้ไว้ที่เดียว
 * @param chapters บทที่แสดงในเล่ม [{ topic, rules, flow }]
 * @param map ผลจาก mapBook() ใน brain.js { labels, links } หรือ null ถ้ายังทำไม่สำเร็จ
 * @param labels เลขข้อในเล่ม (id → "1.2")
 */
export function diagramContext(chapters, map, labels) {
  const chapterOf = new Map();
  const rules = new Map();
  const order = new Map();
  chapters.forEach((chapter, i) =>
    chapter.rules.forEach((rule) => {
      chapterOf.set(rule.id, i);
      rules.set(rule.id, rule);
      order.set(rule.id, order.size);
    }),
  );
  const short = new Map((map?.labels ?? []).map((l) => [l.id, l.label]));
  // เส้นที่ปลายข้างใดข้างหนึ่งถูกซ่อนหรือเลิกใช้ไปแล้วต้องไม่ขึ้น
  const links = (map?.links ?? []).filter(
    (l) => chapterOf.has(l.a) && chapterOf.has(l.b) && chapterOf.get(l.a) !== chapterOf.get(l.b),
  );
  const near = new Map();
  for (const { a, b, why } of links) {
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!near.has(from)) near.set(from, []);
      near.get(from).push({ id: to, why });
    }
  }
  for (const list of near.values()) list.sort((x, y) => order.get(x.id) - order.get(y.id));

  return {
    chapters,
    labels,
    chapterOf,
    rules,
    links,
    mapped: Boolean(map),
    /** ชื่อสั้นของกฎ ถ้า AI ยังตั้งให้ไม่ได้ ใช้ชื่อเต็มแทน (ผังจะตัดให้เอง) */
    short: (id) => short.get(id) || rules.get(id)?.title || '',
    /** กฎในบทอื่นที่เกี่ยวข้องกับกฎข้อนี้ [{ id, why }] */
    near: (id) => near.get(id) ?? [],
  };
}

/** เลขข้อบนป้ายเล็ก ๆ ถ้าขั้นหนึ่งมาจากหลายข้อ ย่อเป็น "1.2 +2" */
function ruleTag(ids, ctx) {
  const nums = ids.map((id) => ctx.labels.get(id));
  if (nums.length <= 1) return nums[0] ?? '';
  const two = `${nums[0]}, ${nums[1]}`;
  return nums.length === 2 && two.length <= 9 ? two : `${nums[0]} +${nums.length - 1}`;
}

/** ป้ายเลขข้อ กดแล้วไปที่กฎข้อนั้น */
function chipLink(x, y, w, h, ids, ctx, { size = 12, cls = '' } = {}) {
  const tip = ids.map((id) => `ข้อ ${ctx.labels.get(id)} ${ctx.rules.get(id).title}`).join('\n');
  return `<a class="dg-chip${cls ? ` ${cls}` : ''}" href="#rule-${ids[0]}"><title>${esc(tip)}</title>`
    + `<rect x="${num(x - w / 2)}" y="${num(y - h / 2)}" width="${w}" height="${h}" rx="${h / 2}"/>`
    + `${svgText(x, y, [ruleTag(ids, ctx)], '', size, { weight: 700 })}</a>`;
}

/** ป้ายลูกศร (สัญลักษณ์ "ต่อที่หน้าอื่น" ของ flowchart) ชี้ไปกฎที่เกี่ยวข้องในบทอื่น */
function tieLink(x, cy, w, tie, ctx, perLine, size = 11.5) {
  const ch = ctx.chapterOf.get(tie.id);
  const label = ctx.labels.get(tie.id);
  const tip = `บทที่ ${ch + 1} · ข้อ ${label} ${ctx.rules.get(tie.id).title}${tie.why ? `\nเกี่ยวกันเพราะ ${tie.why}` : ''}`;
  return `<a class="dg-tie-link" href="#rule-${tie.id}" style="--c:${tint(ch)}"><title>${esc(tip)}</title>`
    + `<path d="M${num(x)} ${num(cy - 19)} h${w - 13} l13 19 l-13 19 h${-(w - 13)} z"/>`
    + svgText(x + 9, cy - 8, [`→ บท ${ch + 1} · ข้อ ${label}`], 'dg-tie-a', size, { anchor: 'start', weight: 700 })
    + svgText(x + 9, cy + 9, [clip(ctx.short(tie.id), perLine)], 'dg-t', size - 0.5, { anchor: 'start' })
    + '</a>';
}

// ---------- ผังขั้นตอน ----------

/** ขั้นหนึ่งมีป้าย "เกี่ยวข้องกับบทอื่น" ได้ไม่เกินกี่ป้าย */
const MAX_TIES = 3;
const NO_ONE = 'ไม่ระบุผู้ทำ';

/** แปลงผลจาก AI เป็นลำดับกล่องที่จะวาด มีกล่องเริ่มกับกล่องจบหัวท้าย */
function flowNodes(flow, chapterIndex, ctx) {
  const shown = new Set();
  // ป้ายเกี่ยวข้องกับบทอื่น ข้อเดียวกันขึ้นครั้งเดียวต่อผัง ที่ขั้นแรกที่เจอ
  const tiesOf = (ids) => {
    const ties = [];
    for (const id of ids) {
      for (const tie of ctx.near(id)) {
        if (ties.length >= MAX_TIES || shown.has(tie.id)) continue;
        shown.add(tie.id);
        ties.push(tie);
      }
    }
    return ties;
  };
  const steps = flow.steps.map((s) => {
    // กฎที่ถูกซ่อนหรือย้ายบทไปแล้วไม่ต้องมีป้าย
    const rules = (s.rules ?? []).filter((id) => ctx.chapterOf.get(id) === chapterIndex);
    const node = { k: s.type === 'decision' ? 'q' : 'step', text: s.text, who: s.who, rules, ties: tiesOf(rules) };
    if (node.k === 'q') {
      node.main = s.continue;
      node.side = {
        kind: s.other?.kind ?? 'unknown',
        text: s.other?.text ?? '',
        who: s.other?.who ?? '',
        answer: s.continue === 'ใช่' ? 'ไม่' : 'ใช่',
      };
    }
    return node;
  });
  return [
    { k: 'start', text: flow.start || 'เริ่ม', rules: [], ties: [] },
    ...steps,
    { k: 'end', text: flow.end || 'เสร็จ', rules: [], ties: [] },
  ];
}

/**
 * แถวของแบบแยกตามฝ่าย เรียงตามลำดับที่ฝ่ายนั้นโผล่มาในผัง ขั้นที่กฎไม่ได้บอกว่าใครทำอยู่แถวท้ายสุด
 * คืน [] ถ้าแยกแล้วไม่ได้อะไร (กฎไม่บอกเลยว่าใครทำ หรือมีฝ่ายเดียว)
 */
function assignLanes(nodes) {
  const named = [];
  let unnamed = false;
  const laneFor = (who) => {
    if (!who) {
      unnamed = true;
      return NO_ONE;
    }
    if (!named.includes(who)) named.push(who);
    return who;
  };
  for (const n of nodes) {
    if (n.k === 'start' || n.k === 'end') continue;
    n.lane = laneFor(n.who);
    if (n.side) n.side.lane = n.side.kind !== 'unknown' && n.side.who ? laneFor(n.side.who) : n.lane;
  }
  nodes[0].lane = nodes[1].lane;
  nodes[nodes.length - 1].lane = nodes[nodes.length - 2].lane;
  const lanes = unnamed ? [...named, NO_ONE] : named;
  return named.length && lanes.length >= 2 ? lanes : [];
}

/** กล่องกรณีพิเศษ (คำตอบอีกแบบของจุดตัดสินใจ): ทำเพิ่มแล้วกลับมา / จบตรงนั้น / กฎยังไม่บอก */
function sideNode(side, x, y, w, h, perLine, size) {
  const box = { step: 'dg-box dg-side-step', stop: 'dg-box dg-side-stop', unknown: 'dg-gap' }[side.kind];
  const ink = { step: 'dg-t', stop: 'dg-t-muted', unknown: 'dg-t-warn' }[side.kind];
  const lines =
    side.kind === 'unknown'
      ? [...(side.text ? [clip(side.text, perLine)] : []), 'ยังไม่มีกฎ']
      : wrap(side.text || 'จบ', perLine, 2);
  return `<rect class="${box}" x="${num(x - w / 2)}" y="${num(y - h / 2)}" width="${w}" height="${h}" rx="12"/>`
    + svgText(x, y, lines, ink, size, { weight: side.kind === 'stop' ? 500 : 600 });
}

const F1 = { chip: 34, cx: 214, sx: 430, lx: 524, lw: 176 };

/** แบบ "ทีละขั้น": เลขข้อซ้าย ขั้นตอนตรงกลาง กรณีพิเศษขวา ป้ายเกี่ยวข้องกับบทอื่นขวาสุด */
function flowTopDown(nodes, ctx, topic) {
  const { chip, cx, sx, lx, lw } = F1;
  const hasTies = nodes.some((n) => n.ties.length);
  const hasSide = nodes.some((n) => n.side);
  const W = hasTies ? lx + lw + 6 : hasSide ? sx + 82 : cx + 114;
  const shapeOf = (n) => {
    if (n.k === 'q') return { half: 108, h: 92, lines: wrap(n.text, 14, 2) };
    if (n.k === 'step') return { half: 105, h: 58, lines: wrap(n.text, 22, 2) };
    const lines = wrap(n.text, 22, 2);
    return { half: 100, h: lines.length > 1 ? 52 : 40, lines };
  };

  let y = 46;
  const rows = nodes.map((n) => {
    const shape = shapeOf(n);
    const rowH = Math.max(shape.h, n.side ? 54 : 0, n.ties.length * 46 - 6);
    const row = { n, ...shape, rowH, yc: y + rowH / 2, rejoin: n.side?.kind === 'step' };
    y += rowH + (row.rejoin ? 62 : 36);
    return row;
  });
  const last = rows[rows.length - 1];
  const H = Math.ceil(last.yc + last.rowH / 2 + 14);

  const back = [`<line class="dg-rule" x1="6" y1="30" x2="${W - 6}" y2="30"/>`];
  const front = [];
  const heads = [[chip, 'ข้อ'], [cx, 'ขั้นตอน'], hasSide && [sx, 'กรณีพิเศษ'], hasTies && [lx + lw / 2, 'เกี่ยวข้องกับบทอื่น']];
  for (const [x, label] of heads.filter(Boolean)) front.push(svgText(x, 16, [label], 'dg-t-head', 11.5));

  rows.forEach((row, i) => {
    const { n, half, h, lines, yc } = row;
    const next = rows[i + 1];

    if (n.k === 'q') {
      front.push(`<path class="dg-q" d="M${cx} ${num(yc - h / 2)} L${cx + half} ${num(yc)} L${cx} ${num(yc + h / 2)} L${cx - half} ${num(yc)} Z"/>`);
      front.push(svgText(cx, yc, lines, 'dg-t', 13.5, { weight: 600 }));
    } else if (n.k === 'step') {
      front.push(`<rect class="dg-box" x="${cx - half}" y="${num(yc - h / 2)}" width="${half * 2}" height="${h}" rx="13"/>`);
      front.push(svgText(cx, yc, lines, 'dg-t', 13.5));
    } else {
      front.push(`<rect class="dg-pill" x="${cx - half}" y="${num(yc - h / 2)}" width="${half * 2}" height="${h}" rx="${h / 2}" fill="url(#dg-g-${n.k})"/>`);
      front.push(svgText(cx, yc, lines, 'dg-t-dark', 13.5, { weight: 700 }));
    }
    if (n.rules.length) {
      back.push(`<line class="dg-guide" x1="${chip + 32}" y1="${num(yc)}" x2="${cx - half}" y2="${num(yc)}"/>`);
      front.push(chipLink(chip, yc, 62, 24, n.rules, ctx));
    }

    if (next) {
      const tone = n.k === 'q' ? 'v' : next.n.k === 'end' ? 'o' : 'a';
      back.push(arrow(`M${cx} ${num(yc + h / 2)} L${cx} ${num(next.yc - next.h / 2 - 2)}`, tone));
      if (n.k === 'q') {
        front.push(svgText(cx + 10, yc + h / 2 + 16, [n.main], n.main === 'ใช่' ? 'dg-t-yes' : 'dg-t-muted', 12, { anchor: 'start', weight: 700 }));
      }
    }

    if (n.side) {
      const side = n.side;
      back.push(arrow(`M${cx + half} ${num(yc)} L${sx - 77} ${num(yc)}`, side.kind === 'unknown' ? 'w' : 'v'));
      front.push(svgText((cx + half + sx - 75) / 2, yc - 9, [side.answer], side.answer === 'ใช่' ? 'dg-t-yes' : 'dg-t-muted', 12, { weight: 700 }));
      front.push(sideNode(side, sx, yc, 150, 54, 16, 13));
      if (side.who && side.kind !== 'unknown') front.push(svgText(sx, yc - 37, [clip(side.who, 20)], 'dg-t-muted', 11));
      if (side.kind === 'step' && next) {
        const joinY = num(yc + h / 2 + 31);
        back.push(arrow(`M${sx} ${num(yc + 27)} L${sx} ${joinY} L${cx + 8} ${joinY}`, 'a'));
        front.push(`<circle class="dg-join" cx="${cx}" cy="${joinY}" r="4"/>`);
      }
    }

    const from = n.side ? sx + 75 : cx + half;
    n.ties.forEach((tie, j) => {
      const cy = yc + (j - (n.ties.length - 1) / 2) * 46;
      back.push(`<path class="dg-tie" style="--c:${tint(ctx.chapterOf.get(tie.id))}" d="M${from} ${num(yc)} C${from + 22} ${num(yc)}, ${lx - 22} ${num(cy)}, ${lx} ${num(cy)}"/>`);
      front.push(tieLink(lx, cy, lw, tie, ctx, 19));
    });
  });

  const steps = nodes.length - 2;
  return `<svg class="dg-svg" viewBox="0 0 ${W} ${H}" style="max-width:${W}px;min-width:${Math.min(W, 480)}px" role="img"
    aria-label="ผังขั้นตอนของบท ${esc(topic)} ${steps} ขั้น เรียงจากบนลงล่าง">${back.join('')}${front.join('')}</svg>`;
}

/** แบบ "แยกตามฝ่าย": แต่ละแถวคือฝ่ายที่ทำ อ่านซ้ายไปขวา แถวล่างสุดเป็นป้ายเกี่ยวข้องกับบทอื่น */
function flowLanes(nodes, lanes, ctx, topic) {
  const LABW = 108;
  const COL = 132;
  const X0 = LABW + 10 + COL / 2;
  const TOP = 28;
  const items = nodes.map((n, i) => {
    const L = lanes.indexOf(n.lane);
    let side = null;
    if (n.side) {
      const Ls = lanes.indexOf(n.side.lane);
      // กรณีพิเศษที่ฝ่ายเดียวกันทำ วางไว้ชั้นล่างของแถวเดียวกัน ของฝ่ายอื่นวางในแถวของฝ่ายนั้น
      side = { s: n.side, L: Ls, sub: Ls === L ? 1 : 0 };
    }
    return { n, L, side, x: X0 + i * COL };
  });
  const lower = lanes.map((_, L) => items.some((it) => it.side && it.side.L === L && it.side.sub === 1));
  let yy = TOP;
  const lane = lanes.map((name, L) => {
    const h = lower[L] ? 196 : 110;
    const r = { name, y: yy, h, y0: yy + 56, y1: yy + 56 + 94 };
    yy += h;
    return r;
  });
  const stack = Math.max(0, ...items.map((it) => it.n.ties.length));
  const strip = stack ? { name: 'เกี่ยวข้องกับบทอื่น', y: yy, h: stack * 46 + 22 } : null;
  if (strip) yy += strip.h;
  const W = X0 + (items.length - 1) * COL + COL / 2 + 8;
  const H = yy + 4;

  const bg = [svgText(LABW + 12, 15, ['ลำดับงาน →'], 'dg-t-head', 11.5, { anchor: 'start' })];
  [...lane, ...(strip ? [{ ...strip, strip: true }] : [])].forEach((band, i) => {
    bg.push(`<rect class="dg-lane${band.strip ? ' strip' : i % 2 ? ' alt' : ''}" x="0" y="${band.y}" width="${W}" height="${band.h}"/>`);
    bg.push(`<rect class="dg-lane-head${band.strip ? ' strip' : ''}" x="0" y="${band.y}" width="${LABW}" height="${band.h}"/>`);
    bg.push(`<line class="dg-rule" x1="0" y1="${band.y}" x2="${W}" y2="${band.y}"/>`);
    bg.push(svgText(LABW / 2, band.y + band.h / 2, wrap(band.name, 10, 3), band.strip ? 'dg-t-strip' : 'dg-t-lane', 12.5, { weight: 600 }));
  });
  bg.push(`<line class="dg-rule" x1="0" y1="${yy}" x2="${W}" y2="${yy}"/>`);
  bg.push(`<line class="dg-rule" x1="${LABW}" y1="${TOP}" x2="${LABW}" y2="${yy}"/>`);

  const halfW = (k) => (k === 'q' ? 58 : 52);
  const halfH = (k) => (k === 'q' ? 46 : k === 'step' ? 28 : 19);
  const yOf = (it) => lane[it.L].y0;
  const sideY = (it) => (it.side.sub ? lane[it.side.L].y1 : lane[it.side.L].y0);
  const back = [];
  const front = [];

  items.forEach((A, i) => {
    const B = items[i + 1];
    const { n } = A;
    const ya = yOf(A);
    if (B) {
      const yb = yOf(B);
      const ar = A.x + halfW(n.k);
      const bl = B.x - halfW(B.n.k) - 2;
      const mx = A.x + COL / 2 - 4;
      const tone = n.k === 'q' ? 'v' : B.n.k === 'end' ? 'o' : 'a';
      back.push(arrow(ya === yb ? `M${ar} ${ya} L${bl} ${yb}` : `M${ar} ${ya} L${mx} ${ya} L${mx} ${yb} L${bl} ${yb}`, tone));
      // คำตอบของทางหลักวางเหนือเส้น ไม่ให้หัวลูกศรทับ
      if (n.k === 'q') front.push(svgText(ar + 3, ya - 9, [n.main], n.main === 'ใช่' ? 'dg-t-yes' : 'dg-t-muted', 11.5, { anchor: 'start', weight: 700 }));
    }
    if (A.side) {
      const { s } = A.side;
      const sy = sideY(A);
      const down = sy > ya;
      const y1 = down ? ya + halfH(n.k) : ya - halfH(n.k);
      const y2 = down ? sy - 30 : sy + 30;
      back.push(arrow(`M${A.x} ${y1} L${A.x} ${y2}`, s.kind === 'unknown' ? 'w' : 'v'));
      front.push(svgText(A.x + 6, down ? y1 + 15 : y1 - 7, [s.answer], s.answer === 'ใช่' ? 'dg-t-yes' : 'dg-t-muted', 11.5, { anchor: 'start', weight: 700 }));
      if (s.kind === 'step' && B) {
        const yb = yOf(B);
        const mx = A.x + COL / 2 + 4;
        const bl = B.x - halfW(B.n.k) - 2;
        back.push(arrow(`M${A.x + 52} ${sy} L${mx} ${sy} L${mx} ${yb} L${bl} ${yb}`, 'a'));
      }
    }
  });

  items.forEach((A) => {
    const { n } = A;
    const y = yOf(A);
    if (n.k === 'q') {
      front.push(`<path class="dg-q" d="M${A.x} ${y - 46} L${A.x + 58} ${y} L${A.x} ${y + 46} L${A.x - 58} ${y} Z"/>`);
      front.push(svgText(A.x, y, wrap(n.text, 11, 3), 'dg-t', 10.5, { weight: 600, lh: 13 }));
    } else if (n.k === 'step') {
      front.push(`<rect class="dg-box" x="${A.x - 52}" y="${y - 28}" width="104" height="56" rx="12"/>`);
      front.push(svgText(A.x, y, wrap(n.text, 12, 3), 'dg-t', 11.5, { lh: 14 }));
    } else {
      front.push(`<rect class="dg-pill" x="${A.x - 52}" y="${y - 19}" width="104" height="38" rx="19" fill="url(#dg-g-${n.k})"/>`);
      front.push(svgText(A.x, y, wrap(n.text, 12, 2), 'dg-t-dark', 11, { weight: 700, lh: 14 }));
    }
    if (n.rules.length) {
      const label = ruleTag(n.rules, ctx);
      front.push(chipLink(A.x, y - halfH(n.k) - 1, 14 + label.length * 6.4, 20, n.rules, ctx, { size: 11, cls: n.k === 'q' ? 'q' : '' }));
    }
    if (A.side) front.push(sideNode(A.side.s, A.x, sideY(A), 104, 56, 12, 11.5));
    n.ties.forEach((tie, j) => front.push(tieLink(A.x - 58, strip.y + 31 + j * 46, 118, tie, ctx, 12, 11)));
  });

  return `<svg class="dg-svg wide" viewBox="0 0 ${W} ${H}" style="width:${W}px" role="img"
    aria-label="ผังขั้นตอนของบท ${esc(topic)} แยกแถวตามฝ่ายที่ทำ ${lanes.length} ฝ่าย อ่านจากซ้ายไปขวา">${bg.join('')}${back.join('')}${front.join('')}</svg>`;
}

const tabs = (items, current) =>
  `<div class="dg-tabs" role="group" aria-label="เลือกแบบผัง">${items
    .map(([mode, label]) => `<button type="button" data-mode="${mode}" aria-pressed="${mode === current}">${label}</button>`)
    .join('')}</div>`;

/** ผังขั้นตอนของบท วางใต้คำอธิบายบท คืนค่าว่างถ้าบทนี้ไม่ใช่ขั้นตอนการทำงาน */
export function flowFigure(chapter, index, ctx) {
  const { flow } = chapter;
  if (!flow?.flow || !Array.isArray(flow.steps) || flow.steps.length < 2) return '';
  const nodes = flowNodes(flow, index, ctx);
  const lanes = assignLanes(nodes);
  const topDown = flowTopDown(nodes, ctx, chapter.topic);
  const byLane = lanes.length ? flowLanes(nodes, lanes, ctx, chapter.topic) : '';
  const notes = [
    'กดเลขข้อเพื่อดูกฎข้อนั้น',
    nodes.some((n) => n.ties.length) && 'กดป้ายลูกศรเพื่อไปกฎที่เกี่ยวข้องในบทอื่น',
    nodes.some((n) => n.side?.kind === 'unknown') && 'กล่องสีเหลืองคือจุดที่ยังไม่มีกฎบอกว่าต้องทำอะไร',
  ].filter(Boolean);

  return `<figure class="dg dg-flow" data-mode="f1">
    <div class="dg-head">
      <p class="dg-title">ผังขั้นตอน</p>
      ${byLane ? tabs([['f1', 'ทีละขั้น'], ['f2', 'แยกตามฝ่าย']], 'f1') : ''}
    </div>
    <div class="dg-view" data-view="f1"><div class="dg-scroll">${topDown}</div></div>
    ${byLane ? `<div class="dg-view" data-view="f2"><div class="dg-scroll">${byLane}</div></div>` : ''}
    <figcaption>วาดจากกฎในบทนี้ · ${notes.join(' · ')}</figcaption>
  </figure>`;
}

// ---------- แผนผังความคิด ----------

/** หนังสืออยู่กลาง บทแตกกิ่งออกซ้ายขวาวนตามเข็มนาฬิกา กฎแต่ละข้อเป็นใบ เส้นโค้งจาง ๆ เชื่อมกฎต่างบทที่เกี่ยวกัน */
function mindMap(ctx) {
  const W = 1320;
  const cx = 660;
  const LEAF = 25;
  const GAP = 30;
  const PW = 180;
  const chs = ctx.chapters.map((c, i) => ({ i, topic: c.topic, rules: c.rules, name: wrap(c.topic, 17, 2) }));
  const blockH = (c) => Math.max(c.rules.length * LEAF, c.name.length > 1 ? 64 : 50);

  // ฝั่งขวาเอาบทจากบนลงล่างจนได้ราวครึ่งหนึ่งของความสูงทั้งหมด ที่เหลือไปฝั่งซ้าย (ไล่จากล่างขึ้นบน)
  const total = chs.reduce((sum, c) => sum + blockH(c), 0);
  let k = 0;
  let acc = 0;
  while (k < chs.length && (k === 0 || acc + blockH(chs[k]) / 2 <= total / 2)) {
    acc += blockH(chs[k]);
    k += 1;
  }
  const right = chs.slice(0, k);
  const left = chs.slice(k).reverse();
  const sideH = (list) => list.reduce((sum, c) => sum + blockH(c), 0) + GAP * Math.max(0, list.length - 1);
  const H = Math.ceil(Math.max(sideH(right), sideH(left), 200) + 96);
  const cy = H / 2;

  const leaf = new Map();
  const place = (list, side) => {
    let y = cy - sideH(list) / 2;
    for (const c of list) {
      const h = blockH(c);
      const yc = y + h / 2;
      const dy = (yc - cy) / (H / 2);
      // บทที่อยู่กลางยื่นออกไกลกว่าบทบนสุดล่างสุด กิ่งจะเรียงเป็นแนวโค้ง
      const off = 180 + 110 * Math.sqrt(Math.max(0, 1 - dy * dy));
      Object.assign(c, { x: cx + side * off, y: yc, side });
      c.rules.forEach((r, j) =>
        leaf.set(r.id, { x: c.x + side * (PW / 2 + 34), y: yc + (j - (c.rules.length - 1) / 2) * LEAF, side }),
      );
      y += h + GAP;
    }
  };
  place(right, 1);
  place(left, -1);

  const defs = [];
  const links = [];
  ctx.links.forEach((l, n) => {
    const A = leaf.get(l.a);
    const B = leaf.get(l.b);
    const pull = 0.62;
    const c1 = { x: A.x + (cx - A.x) * pull, y: A.y + (cy - A.y) * pull };
    const c2 = { x: B.x + (cx - B.x) * pull, y: B.y + (cy - B.y) * pull };
    defs.push(`<linearGradient id="m1-l${n}" gradientUnits="userSpaceOnUse" x1="${num(A.x)}" y1="${num(A.y)}" x2="${num(B.x)}" y2="${num(B.y)}">`
      + `<stop offset="0" stop-color="${tint(ctx.chapterOf.get(l.a))}"/><stop offset="1" stop-color="${tint(ctx.chapterOf.get(l.b))}"/></linearGradient>`);
    links.push(`<path class="m1-link" data-a="${l.a}" data-b="${l.b}" stroke="url(#m1-l${n})" d="M${num(A.x)} ${num(A.y)} C${num(c1.x)} ${num(c1.y)}, ${num(c2.x)} ${num(c2.y)}, ${num(B.x)} ${num(B.y)}"/>`);
  });

  const branches = [];
  const nodes = [];
  for (const c of chs) {
    const [light, deep, accent] = dye(c.i);
    const inner = c.x - (c.side * PW) / 2;
    const outer = c.x + (c.side * PW) / 2;
    const pillH = c.name.length > 1 ? 62 : 48;
    defs.push(`<linearGradient id="m1-c${c.i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".7" stop-color="${deep}"/><stop offset="1" stop-color="${accent}"/></linearGradient>`);
    const twigs = c.rules.map((r) => {
      const p = leaf.get(r.id);
      return `<path class="m1-twig" d="M${num(outer)} ${num(c.y)} C${num(outer + c.side * 18)} ${num(c.y)}, ${num(p.x - c.side * 18)} ${num(p.y)}, ${num(p.x)} ${num(p.y)}"/>`;
    });
    branches.push(`<g class="m1-br" data-ch="${c.i}" style="--c:${light}">`
      + `<path class="m1-trunk" d="M${cx + c.side * 78} ${num(cy)} C${cx + c.side * 130} ${num(cy)}, ${num(inner - c.side * 50)} ${num(c.y)}, ${num(inner)} ${num(c.y)}"/>`
      + `${twigs.join('')}</g>`);
    nodes.push(`<g class="m1-chap" data-ch="${c.i}" tabindex="0" role="button" aria-label="บทที่ ${c.i + 1} ${esc(c.topic)}">`
      + `<title>บทที่ ${c.i + 1} · ${esc(c.topic)}</title>`
      + `<rect x="${num(c.x - PW / 2)}" y="${num(c.y - pillH / 2)}" width="${PW}" height="${pillH}" rx="${pillH / 2}" fill="url(#m1-c${c.i})"/>`
      + svgText(c.x, c.y - 8, c.name, 'm1-name', 13.5, { weight: 700, lh: 16 })
      + svgText(c.x, c.y + pillH / 2 - 12, [`บทที่ ${c.i + 1} · ${c.rules.length} ข้อ`], 'm1-sub', 11)
      + '</g>');
    for (const r of c.rules) {
      const p = leaf.get(r.id);
      const s = p.side;
      // ระยะห่างระหว่างชื่อกับเลขข้อใส่ไว้ที่ dx ของชิ้นที่สอง (ใส่ในชิ้นว่างเบราว์เซอร์จะไม่สนใจ)
      const number = (gap) => `<tspan class="m1-no"${gap ? ' dx="6"' : ''}>${esc(ctx.labels.get(r.id))}</tspan>`;
      const name = (gap) => `<tspan${gap ? ' dx="6"' : ''}>${esc(clip(ctx.short(r.id), 24))}</tspan>`;
      nodes.push(`<g class="m1-leaf" data-id="${r.id}" tabindex="0" role="button" style="--c:${light}">`
        + `<title>ข้อ ${esc(ctx.labels.get(r.id))} ${esc(r.title)}</title>`
        + `<rect class="m1-hit" x="${num(s > 0 ? p.x - 6 : p.x - 236)}" y="${num(p.y - 11)}" width="242" height="22"/>`
        + `<circle class="m1-dot" cx="${num(p.x)}" cy="${num(p.y)}" r="3.6"/>`
        + `<text class="dg-t" x="${num(p.x + s * 9)}" y="${num(p.y)}" font-size="12.5" text-anchor="${s > 0 ? 'start' : 'end'}" dominant-baseline="central">`
        + `${s > 0 ? name(false) + number(true) : number(false) + name(true)}</text></g>`);
    }
  }
  nodes.push(`<circle cx="${cx}" cy="${num(cy)}" r="76" fill="url(#dg-g-core)" filter="url(#dg-glow)"/>`);
  nodes.push(`<circle class="m1-ring" cx="${cx}" cy="${num(cy)}" r="76"/>`);
  nodes.push(svgText(cx, cy - 10, ['Knowledge', 'Management'], 'm1-core', 15, { weight: 700, lh: 18 }));
  nodes.push(svgText(cx, cy + 28, ['for SCM'], 'm1-core-sub', 12.5));

  return `<svg id="dg-m1" class="dg-svg m1" viewBox="0 0 ${W} ${H}" style="min-width:900px" role="img"
    aria-label="แผนผังความคิดของทั้งเล่ม ${chs.length} บท ${leaf.size} ข้อ เส้นโค้งตรงกลางเชื่อมกฎต่างบทที่เกี่ยวข้องกัน">
    <defs>${defs.join('')}</defs><g>${links.join('')}</g><g>${branches.join('')}</g><g>${nodes.join('')}</g></svg>`;
}

// ---------- วงโคจร ----------

/** จำนวนคู่กฎที่เกี่ยวกันระหว่างบทแต่ละคู่ key = "บทน้อย-บทมาก" */
function chapterPairs(ctx) {
  const pairs = new Map();
  for (const l of ctx.links) {
    const a = ctx.chapterOf.get(l.a);
    const b = ctx.chapterOf.get(l.b);
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  return [...pairs].map(([key, count]) => {
    const [a, b] = key.split('-').map(Number);
    return { a, b, count };
  });
}

/** บทโคจรรอบมาสคอต ลูกยิ่งใหญ่ยิ่งมีกฎเยอะ เส้นยิ่งหนายิ่งเกี่ยวกันเยอะ กดลูกไหนเห็นรายละเอียดบทนั้นด้านข้าง */
function orbit(ctx) {
  const n = ctx.chapters.length;
  const max = Math.max(1, ...ctx.chapters.map((c) => c.rules.length));
  const R = 37;
  // ที่ว่างบนวงต่อหนึ่งบท บทเยอะลูกจะเล็กลงเอง ไม่ชนกัน
  const room = ((2 * Math.PI * R) / n) * 0.8;
  const spots = ctx.chapters.map((c, i) => {
    const angle = ((-90 + (360 / n) * i) * Math.PI) / 180;
    const size = Math.min(19, room) * (0.6 + (0.4 * c.rules.length) / max);
    return { x: 50 + R * Math.cos(angle), y: 50 + R * Math.sin(angle), size };
  });
  const pairs = chapterPairs(ctx);
  const degree = ctx.chapters.map((_, i) => pairs.reduce((sum, p) => sum + (p.a === i || p.b === i ? p.count : 0), 0));
  const pick = Math.max(0, degree.indexOf(Math.max(...degree)));

  const lines = pairs.map(({ a, b, count }) => {
    const A = spots[a];
    const B = spots[b];
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    const qx = mx + (50 - mx) * 0.45;
    const qy = my + (50 - my) * 0.45;
    const hot = a === pick || b === pick;
    return `<path class="m3-line${hot ? ' hot' : ''}" data-a="${a}" data-b="${b}" style="--c:${tint(pick)}" stroke-width="${num(0.3 + 0.32 * count)}"
      d="M${num(A.x)} ${num(A.y)} Q${num(qx)} ${num(qy)} ${num(B.x)} ${num(B.y)}"/>`;
  });

  const planets = ctx.chapters.map((c, i) => {
    const [p1, p2, p3] = dye(i);
    const s = spots[i];
    return `<button type="button" class="m3-planet" data-ch="${i}" aria-pressed="${i === pick}"
      style="left:${num(s.x)}%;top:${num(s.y)}%;width:${num(s.size)}%;height:${num(s.size)}%;--p1:${p1};--p2:${p2};--p3:${p3}"
      aria-label="บทที่ ${i + 1} ${esc(c.topic)} ${c.rules.length} ข้อ"><span class="m3-name">${breakable(c.topic)}</span><span class="m3-n">${c.rules.length} ข้อ</span></button>`;
  });

  const panels = ctx.chapters.map((c, i) => {
    const related = pairs
      .filter((p) => p.a === i || p.b === i)
      .map((p) => ({ other: p.a === i ? p.b : p.a, count: p.count }))
      .sort((x, y) => y.count - x.count || x.other - y.other);
    const rel = related.length
      ? `<span>เกี่ยวข้องกับ</span>${related
          .map(({ other, count }) => `<button type="button" class="dg-pick" data-m3-ch="${other}" style="--c:${tint(other)}">บท ${other + 1} ${esc(clip(ctx.chapters[other].topic, 20))} · ${count}</button>`)
          .join('')}`
      : '<span>ยังไม่พบกฎที่เกี่ยวข้องกับบทอื่น</span>';
    const rows = c.rules.map((r) => {
      const ties = ctx
        .near(r.id)
        .map((t) => {
          const label = ctx.labels.get(t.id);
          const tip = `ข้อ ${label} ${ctx.short(t.id)}${t.why ? ` — ${t.why}` : ''}`;
          return `<button type="button" class="dg-pick mini" data-m3-rule="${t.id}" style="--c:${tint(ctx.chapterOf.get(t.id))}" title="${esc(tip)}">↔ ${esc(label)}</button>`;
        })
        .join('');
      return `<li data-rule="${r.id}"><a class="ref" href="#rule-${r.id}">${esc(ctx.labels.get(r.id))}</a>`
        + `<span class="m3-rule" title="${esc(r.title)}">${esc(ctx.short(r.id))}${ties ? `<span class="m3-ties">${ties}</span>` : ''}</span></li>`;
    });
    return `<div class="m3-panel" data-ch="${i}" style="--pc:${tint(i)}"${i === pick ? '' : ' hidden'}>
      <p class="m3-eyebrow">บทที่ ${i + 1} · ${c.rules.length} ข้อ</p>
      <p class="m3-title"><a href="#ch-${i + 1}">${esc(c.topic)}</a></p>
      <p class="m3-rel">${rel}</p>
      <ol class="m3-list">${rows.join('')}</ol>
      <p class="m3-hint">↔ คือกฎในบทอื่นที่เกี่ยวข้อง กดเพื่อดูบทนั้น · กดเลขข้อเพื่อเปิดอ่านกฎ</p>
    </div>`;
  });

  return `<div class="m3" id="dg-m3">
    <div class="m3-orbit">
      <svg class="m3-rings" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="m3-glow" cx="50" cy="50" r="20"/>
        <circle class="m3-ring" cx="50" cy="50" r="${R}"/>
        <circle class="m3-ring faint" cx="50" cy="50" r="47"/>
        ${lines.join('')}
      </svg>
      ${MASCOT_URL ? `<img class="m3-mascot" src="${MASCOT_URL}" alt="" draggable="false">` : ''}
      ${planets.join('')}
    </div>
    <div class="m3-panels" aria-live="polite">${panels.join('')}</div>
  </div>`;
}

/** ส่วน "ภาพรวมทั้งเล่ม" วางต่อจากสารบัญ เปิดแผ่นอ่านแบบกว้าง (data-wide) */
export function mapSection(ctx) {
  const ruleCount = ctx.rules.size;
  // ข้อมูลที่สคริปต์ฝั่งเบราว์เซอร์ใช้เขียนแถบรายละเอียดของแผนผังความคิด
  const data = { r: {}, c: ctx.chapters.map((c, i) => [c.topic, tint(i)]), n: {} };
  for (const [id, rule] of ctx.rules) {
    data.r[id] = [ctx.labels.get(id), clip(ctx.short(id), 40), rule.title, ctx.chapterOf.get(id)];
    const near = ctx.near(id);
    if (near.length) data.n[id] = near.map((t) => [t.id, t.why]);
  }
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const linkNote = !ctx.mapped
    ? 'ยังหากฎที่เกี่ยวข้องกันระหว่างบทไม่สำเร็จ ลองเปิดหน้านี้ใหม่อีกครั้ง'
    : ctx.links.length
      ? `กฎต่างบทที่เกี่ยวข้องกัน ${ctx.links.length} คู่`
      : 'ยังไม่พบกฎต่างบทที่เกี่ยวข้องกัน';
  const hint = ctx.links.length
    ? 'กดชื่อข้อหรือชื่อบท เพื่อดูว่าเกี่ยวข้องกับอะไรในบทอื่น'
    : 'กดชื่อข้อหรือชื่อบท เพื่อดูรายละเอียดและเปิดอ่าน';

  return `<section class="chapter dg-mapsec" id="map" data-sec="map" data-wide data-title="ภาพรวมทั้งเล่ม">
    <p class="eyebrow">ภาพรวมทั้งเล่ม</p>
    <h2>แผนผังความรู้</h2>
    <p class="dg-lede">${ctx.chapters.length} บท · ${ruleCount} ข้อ · ${linkNote}</p>
    <figure class="dg dg-map" data-mode="m1">
      <div class="dg-head">
        <p class="dg-title">ดูแบบ</p>
        ${tabs([['m1', 'แผนผังความคิด'], ['m3', 'วงโคจร']], 'm1')}
      </div>
      <div class="dg-view" data-view="m1">
        <div class="dg-scroll">${mindMap(ctx)}</div>
        <div class="dg-info" id="dg-m1-info" aria-live="polite"><span class="dg-info-lbl">${hint}</span></div>
      </div>
      <div class="dg-view" data-view="m3">${orbit(ctx)}</div>
      <figcaption>ชื่อสั้นของแต่ละข้อ และเส้นเชื่อมระหว่างบท AI สรุปจากเนื้อหากฎ อาจตกหล่นหรือคลาดเคลื่อนได้ ให้ยึดตัวกฎในแต่ละบทเป็นหลัก</figcaption>
    </figure>
    <script type="application/json" id="dg-data">${json}</script>
  </section>`;
}

// ---------- ของที่ใช้ร่วมกันทั้งหน้า ----------

/**
 * หัวลูกศรกับสีไล่ที่ผังทุกอันใช้ร่วมกัน วางครั้งเดียวที่ต้นหน้า
 * ห้ามวางในผังแต่ละอัน เพราะผังที่ซ่อนอยู่ (แท็บที่ไม่ได้เลือก) จะทำให้หัวลูกศรของผังอื่นหายไปด้วย
 */
export const DIAGRAM_DEFS = `<svg class="dg-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
${['a', 'v', 'w', 'o']
  .map(
    (t) => `<marker id="dg-m-${t}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-mk-${t}" d="M0,0 L10,5 L0,10 z"/></marker>`,
  )
  .join('')}
<linearGradient id="dg-g-start" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#67e8f9"/><stop offset="1" stop-color="#3b82f6"/></linearGradient>
<linearGradient id="dg-g-end" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ee7b7"/><stop offset="1" stop-color="#14b8a6"/></linearGradient>
<radialGradient id="dg-g-core" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#7dd8ff"/><stop offset=".55" stop-color="#2563eb"/><stop offset="1" stop-color="#4c1d95"/></radialGradient>
<filter id="dg-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs></svg>`;

export const DIAGRAM_STYLE = `
/* ---------- ผังในหนังสือ ---------- */
.dg-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.dg { margin: 22px 0 28px; padding: 14px 14px 12px; border-radius: 16px; background: var(--paper); border: 1px solid var(--line); }
.dg-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin-bottom: 10px; }
.dg-title { margin: 0; font-weight: 700; font-size: .95rem; color: var(--accent); }
.dg-tabs { display: none; gap: 4px; padding: 3px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); }
.js .dg-tabs { display: inline-flex; }
.dg-tabs button {
  font: inherit; font-size: .86rem; padding: 4px 14px; border: 0; border-radius: 999px; cursor: pointer;
  color: var(--muted); background: none;
}
.dg-tabs button:hover { color: var(--ink); }
.dg-tabs button[aria-pressed="true"] { color: var(--ink); font-weight: 600; background: var(--accent-soft); box-shadow: inset 0 0 0 1px rgba(var(--thread), .35); }
.dg-tabs button:focus-visible { outline: 2px solid var(--shine); outline-offset: 1px; }
.js .dg[data-mode="f1"] .dg-view:not([data-view="f1"]),
.js .dg[data-mode="f2"] .dg-view:not([data-view="f2"]),
.js .dg[data-mode="m1"] .dg-view:not([data-view="m1"]),
.js .dg[data-mode="m3"] .dg-view:not([data-view="m3"]) { display: none; }
.dg-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; }
.dg-svg { display: block; width: 100%; height: auto; margin: 0 auto; }
.dg-svg.wide { max-width: none; }
.dg figcaption { margin-top: 8px; font-size: .84rem; line-height: 1.6; color: var(--muted); }
.dg-lede { color: var(--muted); }
.dg svg text { font-family: 'Sarabun', system-ui, sans-serif; }
.dg svg a { cursor: pointer; }
.dg svg a:focus { outline: none; }

/* ตัวหนังสือ */
.dg-t { fill: var(--ink); }
.dg-t-head { fill: var(--muted); letter-spacing: .04em; }
.dg-t-dark { fill: #04101f; }
.dg-t-muted { fill: var(--muted); }
.dg-t-warn { fill: var(--warn); }
.dg-t-yes { fill: var(--ok); }
.dg-t-lane { fill: var(--accent); }
.dg-t-strip { fill: var(--title-c); }

/* กล่องกับเส้น */
.dg-rule { stroke: var(--line); }
.dg-guide { stroke: rgba(var(--thread), .3); stroke-dasharray: 2 4; }
.dg-box { fill: var(--paper); stroke: rgba(var(--thread), .55); stroke-width: 1.5; }
.dg-q { fill: color-mix(in srgb, var(--title-c) 14%, var(--paper)); stroke: var(--title-c); stroke-width: 1.5; }
.dg-pill { filter: drop-shadow(0 0 8px rgba(var(--thread), .45)); }
.dg-side-step { stroke: var(--accent); }
.dg-side-stop { stroke: var(--muted); stroke-opacity: .6; }
.dg-gap { fill: var(--warn-soft); stroke: var(--warn); stroke-width: 1.5; stroke-dasharray: 5 5; }
.dg-ln { fill: none; stroke-width: 2; }
.dg-ln-a { stroke: var(--accent); }
.dg-ln-v { stroke: var(--title-c); }
.dg-ln-w { stroke: var(--warn); stroke-dasharray: 5 5; }
.dg-ln-o { stroke: var(--ok); }
.dg-mk-a { fill: var(--accent); }
.dg-mk-v { fill: var(--title-c); }
.dg-mk-w { fill: var(--warn); }
.dg-mk-o { fill: var(--ok); }
.dg-join { fill: var(--accent); }
.dg-chip rect { fill: color-mix(in srgb, var(--shine) 12%, var(--paper)); stroke: color-mix(in srgb, var(--shine) 55%, transparent); }
.dg-chip text { fill: var(--shine); }
.dg-chip.q rect { fill: var(--bg); stroke: color-mix(in srgb, var(--title-c) 60%, transparent); }
.dg-chip.q text { fill: var(--title-c); }
.dg-chip:hover rect, .dg-chip:focus-visible rect { stroke: var(--shine); stroke-width: 2; }
.dg-tie { fill: none; stroke: var(--c); stroke-width: 1.3; stroke-dasharray: 2 4; }
.dg-tie-link path { fill: color-mix(in srgb, var(--c) 14%, var(--paper)); stroke: var(--c); stroke-width: 1.4; }
.dg-tie-link:hover path, .dg-tie-link:focus-visible path { stroke-width: 2.6; }
.dg-tie-a { fill: var(--c); }
.dg-lane { fill: color-mix(in srgb, var(--paper) 60%, var(--bg)); }
.dg-lane.alt { fill: var(--paper); }
.dg-lane.strip { fill: color-mix(in srgb, var(--title-c) 7%, var(--bg)); }
.dg-lane-head { fill: color-mix(in srgb, var(--accent) 10%, var(--paper)); }
.dg-lane-head.strip { fill: color-mix(in srgb, var(--title-c) 14%, var(--paper)); }

/* แผนผังความคิด */
.m1-link { fill: none; stroke-width: 1.3; opacity: .4; transition: opacity .2s, stroke-width .2s; }
.m1.focus .m1-link { opacity: .06; }
.m1.focus .m1-link.hot { opacity: 1; stroke-width: 2.6; }
.m1-trunk { fill: none; stroke: var(--c); stroke-width: 4.5; stroke-linecap: round; opacity: .85; }
.m1-twig { fill: none; stroke: var(--c); stroke-width: 1.5; opacity: .55; }
.m1-br, .m1-chap, .m1-leaf { transition: opacity .2s; }
.m1-chap, .m1-leaf { cursor: pointer; outline: none; }
.m1-chap rect { stroke: rgba(255, 255, 255, .35); }
.m1-chap:focus-visible rect, .m1-chap:hover rect { stroke: #fff; stroke-width: 2; }
.m1-name { fill: #fff; }
.m1-sub { fill: rgba(255, 255, 255, .88); }
.m1-hit { fill: transparent; }
.m1-dot { fill: var(--c); }
.m1-no { fill: var(--c); font-weight: 700; font-size: 11px; }
.m1-leaf:hover text, .m1-leaf:focus-visible text { text-decoration: underline; }
.m1-leaf.sel text { font-weight: 700; }
.m1.focus .m1-br, .m1.focus .m1-chap, .m1.focus .m1-leaf { opacity: .22; }
.m1.focus .m1-br.hot, .m1.focus .m1-chap.hot, .m1.focus .m1-leaf.hot { opacity: 1; }
.m1-ring { fill: none; stroke: rgba(255, 255, 255, .4); }
.m1-core { fill: #fff; }
.m1-core-sub { fill: #cfe3ff; }
.dg-info {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-height: 2.9em; margin-top: 10px;
  padding: 8px 12px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); font-size: .93rem;
}
.dg-info-lbl { color: var(--muted); font-size: .86rem; }
.dg-pick {
  --c: var(--accent);
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle;
  font: 600 .8rem/1.45 'Sarabun', system-ui, sans-serif; padding: 1px 10px; border-radius: 999px; cursor: pointer;
  color: var(--c); background: color-mix(in srgb, var(--c) 12%, transparent); border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
}
.dg-pick:hover, .dg-pick:focus-visible { background: color-mix(in srgb, var(--c) 26%, transparent); outline: none; }
.dg-pick.mini { font-size: .72rem; padding: 0 7px; }

/* วงโคจร */
.m3 { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.m3-orbit { position: relative; width: 100%; aspect-ratio: 1 / 1; container-type: inline-size; }
.m3-rings { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.m3-glow { fill: rgba(var(--thread), .14); }
.m3-ring { fill: none; stroke: rgba(var(--thread), .22); stroke-width: .3; }
.m3-ring.faint { stroke: rgba(var(--thread), .1); stroke-width: .2; }
.m3-line { fill: none; stroke: rgb(var(--thread)); stroke-linecap: round; opacity: .18; transition: opacity .2s; }
.m3-line.hot { stroke: var(--c); opacity: .95; }
.m3-mascot { position: absolute; left: 50%; top: 50%; width: 21%; transform: translate(-50%, -54%); pointer-events: none; filter: drop-shadow(0 10px 22px rgba(0, 0, 0, .55)); }
.m3-planet {
  position: absolute; transform: translate(-50%, -50%); display: grid; place-content: center; gap: 1px;
  padding: 4px; border: 0; border-radius: 50%; cursor: pointer; text-align: center; color: #fff;
  font-family: 'Sarabun', system-ui, sans-serif; text-shadow: 0 2px 8px rgba(0, 0, 40, .5);
  background:
    radial-gradient(95% 130% at 100% 0%, var(--p3), transparent 64%),
    radial-gradient(120% 120% at 0% 100%, var(--p2), transparent 72%),
    linear-gradient(150deg, var(--p1), var(--p2));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .3), inset 0 2px 0 rgba(255, 255, 255, .45), 0 10px 30px -8px rgba(0, 0, 0, .7);
  transition: transform .25s ease, box-shadow .25s ease;
}
.m3-planet:hover, .m3-planet:focus-visible { transform: translate(-50%, -50%) scale(1.08); outline: none; }
.m3-planet[aria-pressed="true"] {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .5), 0 0 0 3px var(--bg), 0 0 0 5px var(--shine), 0 0 30px rgba(var(--thread), .7);
}
.m3-name {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
  font-weight: 600; line-height: 1.15; font-size: clamp(9px, 2cqw, 14px); word-break: keep-all;
}
.m3-n { font-size: clamp(8px, 1.6cqw, 12px); opacity: .9; }
.m3-panel { display: grid; gap: 10px; padding: 16px 18px; border-radius: 14px; background: var(--bg); border: 1px solid var(--line); }
.m3-panel[hidden] { display: none; }
.m3-eyebrow { margin: 0; font-size: .8rem; font-weight: 600; letter-spacing: .08em; color: var(--pc); }
.m3-title { margin: 0; font: 600 1.3rem/1.35 'Trirong', 'Sarabun', serif; }
.m3-title a { color: var(--ink); text-decoration: none; }
.m3-title a:hover { color: var(--pc); }
.m3-rel { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; font-size: .86rem; color: var(--muted); }
.m3-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.m3-list li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 7px 10px; border-radius: 10px; background: var(--paper); border: 1px solid var(--line); font-size: .93rem; }
.m3-ties { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 6px; vertical-align: middle; }
.m3-hint { margin: 0; font-size: .82rem; color: var(--muted); }
@media (max-width: 860px) {
  .m3 { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .m1-link, .m1-br, .m1-chap, .m1-leaf, .m3-line, .m3-planet { transition: none; }
}
@media print {
  .dg-tabs, .dg-info, .dg-view[data-view="f2"], .dg-view[data-view="m3"], #dg-data { display: none !important; }
  .js .dg .dg-view[data-view="f1"], .js .dg .dg-view[data-view="m1"] { display: block !important; }
  .dg { break-inside: avoid; }
  .dg-scroll { overflow: visible; }
  .dg-svg { min-width: 0 !important; max-width: 100% !important; }
}
`;

// ---------- สคริปต์ฝั่งเบราว์เซอร์ ----------

/**
 * สลับแบบผัง และทำให้แผนผังความคิดกับวงโคจรกดเลือกได้
 * ฟังก์ชันนี้ถูกแปลงเป็นข้อความแล้วฝังลงในหน้าเว็บ จึงห้ามอ้างถึงตัวแปรนอกฟังก์ชัน
 */
function diagramClient() {
  document.addEventListener('click', (e) => {
    const tab = e.target.closest && e.target.closest('.dg-tabs button');
    if (!tab) return;
    const figure = tab.closest('.dg');
    figure.dataset.mode = tab.dataset.mode;
    for (const b of figure.querySelectorAll('.dg-tabs button')) b.setAttribute('aria-pressed', String(b === tab));
  });

  const source = document.getElementById('dg-data');
  if (!source) return;
  const data = JSON.parse(source.textContent);
  const rules = data.r;
  const chapters = data.c;
  const near = data.n;
  const hover = matchMedia('(hover: hover) and (pointer: fine)').matches;

  const make = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) if (value != null) el.setAttribute(key, value);
    el.append(...kids.filter((kid) => kid != null && kid !== false));
    return el;
  };
  const flash = (el) => {
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  };
  const chapterOf = (id) => rules[id][3];

  // ----- แผนผังความคิด: กดข้อหรือบท แล้วเส้นที่เกี่ยวข้องสว่างขึ้น -----
  const m1 = document.getElementById('dg-m1');
  const info = document.getElementById('dg-m1-info');
  if (m1 && info) {
    const resting = [...info.childNodes];
    let chosen = null;
    const linked = (ids) => {
      const set = new Set(ids);
      for (const id of ids) for (const [other] of near[id] || []) set.add(String(other));
      return set;
    };
    const ruleButton = (id, why) =>
      make('button', { type: 'button', class: 'dg-pick', 'data-m1': id, title: why || null, style: `--c:${chapters[chapterOf(id)][1]}` },
        `${rules[id][0]} ${rules[id][1]}`);

    const apply = (pick) => {
      m1.classList.toggle('focus', Boolean(pick));
      const ids = !pick ? [] : pick.rule ? [pick.rule] : Object.keys(rules).filter((id) => chapterOf(id) === pick.chapter);
      const lit = linked(ids);
      const chs = new Set([...lit].map(chapterOf));
      for (const p of m1.querySelectorAll('.m1-link')) p.classList.toggle('hot', ids.includes(p.dataset.a) || ids.includes(p.dataset.b));
      for (const g of m1.querySelectorAll('.m1-leaf')) {
        g.classList.toggle('hot', lit.has(g.dataset.id));
        g.classList.toggle('sel', ids.includes(g.dataset.id));
      }
      for (const g of m1.querySelectorAll('.m1-chap, .m1-br')) g.classList.toggle('hot', chs.has(Number(g.dataset.ch)));

      if (!pick) return info.replaceChildren(...resting);
      if (pick.rule) {
        const [label, , title, ch] = rules[pick.rule];
        const links = near[pick.rule] || [];
        return info.replaceChildren(
          make('strong', { style: `color:${chapters[ch][1]}` }, `ข้อ ${label}`), ' ', title, ' ',
          make('a', { class: 'ref', href: `#rule-${pick.rule}` }, 'เปิดอ่าน'),
          make('span', { class: 'dg-info-lbl' }, links.length ? '· เกี่ยวข้องกับ' : '· ยังไม่พบกฎที่เกี่ยวข้องในบทอื่น'),
          ...links.map(([other, why]) => ruleButton(String(other), why)),
        );
      }
      const counts = new Map();
      for (const id of ids) for (const [other] of near[id] || []) counts.set(chapterOf(other), (counts.get(chapterOf(other)) || 0) + 1);
      return info.replaceChildren(
        make('strong', { style: `color:${chapters[pick.chapter][1]}` }, `บทที่ ${pick.chapter + 1} · ${chapters[pick.chapter][0]}`), ' ',
        make('a', { class: 'ref', href: `#ch-${pick.chapter + 1}` }, 'เปิดอ่านบทนี้'),
        make('span', { class: 'dg-info-lbl' }, counts.size ? '· เกี่ยวข้องกับ' : '· ยังไม่พบกฎที่เกี่ยวข้องในบทอื่น'),
        ...[...counts]
          .sort((a, b) => b[1] - a[1] || a[0] - b[0])
          .map(([c, count]) =>
            make('button', { type: 'button', class: 'dg-pick', 'data-m1c': c, style: `--c:${chapters[c][1]}` }, `บท ${c + 1} ${chapters[c][0]} · ${count}`)),
      );
    };
    const pickFrom = (target) => {
      const leaf = target.closest('.m1-leaf');
      if (leaf) return { rule: leaf.dataset.id };
      const chap = target.closest('.m1-chap');
      return chap ? { chapter: Number(chap.dataset.ch) } : null;
    };
    m1.addEventListener('click', (e) => {
      chosen = pickFrom(e.target);
      apply(chosen);
    });
    m1.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const pick = pickFrom(e.target);
      if (!pick) return;
      e.preventDefault();
      chosen = pick;
      apply(chosen);
    });
    if (hover) {
      m1.addEventListener('mouseover', (e) => {
        const pick = pickFrom(e.target);
        if (pick) apply(pick);
      });
      m1.addEventListener('mouseleave', () => apply(chosen));
    }
    info.addEventListener('click', (e) => {
      const button = e.target.closest('[data-m1], [data-m1c]');
      if (!button) return;
      chosen = button.dataset.m1 ? { rule: button.dataset.m1 } : { chapter: Number(button.dataset.m1c) };
      apply(chosen);
    });
  }

  // ----- วงโคจร: กดลูกไหนเปิดรายละเอียดบทนั้น -----
  const m3 = document.getElementById('dg-m3');
  if (m3) {
    const show = (i, ruleId) => {
      for (const p of m3.querySelectorAll('.m3-planet')) p.setAttribute('aria-pressed', String(Number(p.dataset.ch) === i));
      for (const p of m3.querySelectorAll('.m3-panel')) p.hidden = Number(p.dataset.ch) !== i;
      for (const line of m3.querySelectorAll('.m3-line')) {
        const on = Number(line.dataset.a) === i || Number(line.dataset.b) === i;
        line.classList.toggle('hot', on);
        if (on) line.style.setProperty('--c', chapters[i][1]);
      }
      const row = ruleId && m3.querySelector(`.m3-panel[data-ch="${i}"] [data-rule="${ruleId}"]`);
      if (row) {
        row.scrollIntoView({ block: 'nearest' });
        flash(row);
      }
    };
    m3.addEventListener('click', (e) => {
      const planet = e.target.closest('.m3-planet');
      if (planet) return show(Number(planet.dataset.ch));
      const chapter = e.target.closest('[data-m3-ch]');
      if (chapter) return show(Number(chapter.dataset.m3Ch));
      const rule = e.target.closest('[data-m3-rule]');
      if (rule) return show(chapterOf(rule.dataset.m3Rule), rule.dataset.m3Rule);
    });
  }
}

export const DIAGRAM_SCRIPT = `(${diagramClient})();`;
