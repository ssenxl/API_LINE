/**
 * ตาราง Master MC ในบท Machine ของหนังสือ
 *
 * ข้อมูลมาจากชีต "Master MC" ของไฟล์ Master MC ในโปรเจกต์ Knit Plan
 * ดึงเข้ามาเก็บในตาราง settings ด้วย `npm run sync:mc` (scripts/sync-master-mc.js)
 * ตารางนี้เป็นข้อมูลดิบจากไฟล์ ไม่ผ่าน AI และไม่ใช่กฎ จึงไม่มีเลขข้อ และบอทใน LINE ไม่ได้ใช้ตอบคำถาม
 */

export const MASTER_MC_KEY = 'master_mc';

const count = (n) => Number(n).toLocaleString('en-US');
const gaugeOrder = (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || String(a).localeCompare(String(b));

/** @returns {string} HTML ของตาราง หรือ '' ถ้ายังไม่เคยดึงข้อมูล */
export function masterMcSection(master, { escape, date }) {
  const rows = Array.isArray(master?.rows) ? master.rows : [];
  if (rows.length === 0) return '';

  // เครื่องของโรงเราเอง นับเฉพาะแถวที่มีจำนวนเครื่อง กลุ่มที่ไม่มีจำนวน (จ้างทอ) แยกไปบอกต่างหาก
  const perFactory = new Map();
  const noCount = new Set();
  for (const row of rows) {
    if (typeof row.total === 'number') perFactory.set(row.factory, (perFactory.get(row.factory) ?? 0) + row.total);
    else noCount.add(row.mc);
  }
  const total = [...perFactory.values()].reduce((sum, n) => sum + n, 0);
  const names = new Set(rows.map((row) => row.mc)).size;
  const gauges = [...new Set(rows.map((row) => row.gauge).filter((g) => /^\d/.test(g)))].sort(gaugeOrder);

  const facts = [
    [count(total), 'เครื่อง'],
    ...[...perFactory].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([factory, n]) => [count(n), factory]),
    [names, 'ชื่อเครื่อง (MC)'],
    gauges.length && [`${gauges[0]}–${gauges.at(-1)}`, 'Guage'],
  ]
    .filter(Boolean)
    .map(([value, label]) => `<span><b>${escape(value)}</b> ${escape(label)}</span>`)
    .join('');

  // วัน/สัปดาห์เท่ากันทุกแถวก็บอกครั้งเดียวใต้ตาราง ไม่ต้องกินที่หนึ่งคอลัมน์
  const days = [...new Set(rows.map((row) => row.days))];
  const daysColumn = days.length > 1;
  const num = (value) =>
    typeof value === 'number' ? `<td class="n${value === 0 ? ' zero' : ''}">${count(value)}</td>` : '<td class="n zero">–</td>';

  const body = rows
    .map((row, i) => {
      const name = `${row.mc} ${/^\d/.test(row.gauge) ? `${row.gauge}G` : row.gauge}`.trim();
      const sub = row.subgroup && row.subgroup !== row.group ? row.subgroup : '';
      // data-name กับ data-text ใช้กับช่องค้นหาในเล่ม (ดู buildIndex ใน book-scene.js)
      const found = [
        row.factory,
        row.type,
        row.cat,
        typeof row.total === 'number' ? `${row.total} เครื่อง` : '',
        row.group && `Group ${row.group}`,
        sub && `SUBGroup ${sub}`,
      ]
        .filter(Boolean)
        .join(' · ');
      return `<tr${rows[i - 1]?.mc === row.mc ? '' : ' class="first"'} data-name="${escape(name)}" data-text="${escape(found)}">
        <td class="mc">${escape(row.mc)}</td>
        <td class="n">${escape(row.gauge)}</td>
        ${num(row.total)}
        <td>${escape(row.factory)}</td>
        <td>${escape(row.type)}</td>
        <td>${escape(row.cat)}</td>
        ${num(row.hours)}
        ${daysColumn ? num(row.days) : ''}
        <td class="g">${escape(row.group)}${sub ? `<small>SUBGroup: ${escape(sub)}</small>` : ''}</td>
      </tr>`;
    })
    .join('');

  const notes = [
    !daysColumn && typeof days[0] === 'number' && `ทุกแถวทำงาน ${days[0]} วัน/สัปดาห์`,
    noCount.size && `${[...noCount].join(', ')} ไม่มีจำนวนเครื่องในไฟล์`,
    'SUBGroup แสดงเฉพาะแถวที่ต่างจาก Group',
  ]
    .filter(Boolean)
    .join(' · ');

  return `<div class="mm">
    <h3 id="master-mc">Master MC</h3>
    <p class="meta">ทะเบียนเครื่องทอจากไฟล์ ${escape(master.file)} (ชีต ${escape(master.sheet)}) ของระบบ Knit Plan
      แสดงตามไฟล์ ไม่ได้ผ่านการเรียบเรียงของ AI${master.syncedAt ? ` · ดึงข้อมูลเมื่อ ${date(master.syncedAt)}` : ''}</p>
    <p class="mm-facts">${facts}</p>
    <div class="mm-scroll" tabindex="0" role="region" aria-label="ตาราง Master MC เลื่อนดูได้">
      <table class="mm-table">
        <thead><tr>
          <th>MC</th><th class="n">Guage</th><th class="n">จำนวนเครื่อง</th><th>โรงงาน</th><th>ประเภท</th>
          <th>MC_CAT</th><th class="n">ชม./วัน</th>${daysColumn ? '<th class="n">วัน/สัปดาห์</th>' : ''}<th>Group</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="meta">${escape(notes)}</p>
  </div>`;
}

export const MASTER_MC_STYLE = `
.mm { margin-top: 36px; }
.mm > h3 { margin-top: 0; }
.mm-facts { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; }
.mm-facts span { padding: 3px 14px; border-radius: 999px; background: var(--accent-soft); font-size: .9rem; }
.mm-facts b { margin-right: 4px; color: var(--accent); font-size: 1.08rem; }
/* ตารางยาว 60 แถวขึ้นไป ให้เลื่อนในกรอบของตัวเอง หัวตารางจะได้ค้างอยู่ให้เห็นตลอด */
.mm-scroll {
  max-height: min(72vh, 660px); overflow: auto; overscroll-behavior: contain; margin-bottom: 8px;
  background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
}
.mm-table { width: 100%; border-collapse: collapse; font-size: .9rem; line-height: 1.45; font-variant-numeric: tabular-nums; }
.mm-table th, .mm-table td { padding: 7px 9px; text-align: left; vertical-align: top; white-space: nowrap; }
.mm-table td { border-top: 1px solid transparent; }
/* เส้นคั่นเฉพาะตอนขึ้นชื่อเครื่องใหม่ Guage ของเครื่องเดียวกันจะได้เกาะกันเป็นกลุ่ม */
.mm-table tr.first td { border-top-color: var(--line); }
.mm-table thead th {
  position: sticky; top: 0; z-index: 1; background: var(--paper); color: var(--muted);
  font-size: .8rem; font-weight: 600; box-shadow: inset 0 -1px 0 var(--line);
}
.mm-table .n { text-align: right; }
.mm-table .zero { color: var(--muted); }
.mm-table .mc { font-weight: 700; color: var(--accent); }
.mm-table tr:not(.first) .mc { opacity: .45; }
.mm-table .g { white-space: normal; min-width: 15em; }
.mm-table small { display: block; color: var(--muted); font-size: .8rem; }
.mm-table tbody tr:hover td, .mm-table tr.hit td { background: var(--accent-soft); }
@media print {
  .mm-scroll { max-height: none; overflow: visible; }
  .mm-table { font-size: 8.5pt; }
  .mm-table th, .mm-table td { padding: 3px 6px; white-space: normal; }
  .mm-table thead th { position: static; }
  .mm-table tr { break-inside: avoid; }
}
`;
