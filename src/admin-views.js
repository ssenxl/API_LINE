import { THEME_ATTR, THEME_STYLE, swatch } from './book-scene.js';
import { BOOK_SECTIONS, STYLE, brandMark, date, escape, retiredBy, retirementNote } from './book.js';

/**
 * หน้าตาทุกหน้าของ /admin แยกจาก admin.js ที่ดูแลเส้นทางและสิทธิ์
 * ทุกฟังก์ชันรับข้อมูลที่ดึงมาแล้ว คืนเป็น HTML ไม่แตะฐานข้อมูลเอง
 */

// Neon แพ็กเกจฟรีให้พื้นที่ 0.5 GB ต่อโปรเจกต์
const STORAGE_LIMIT = 512 * 1024 * 1024;

const TABS = [
  ['/admin', 'ภาพรวม'],
  ['/admin/teaching', 'การสอน'],
  ['/admin/rules', 'กฎ'],
  ['/admin/questions', 'คำถาม'],
  ['/admin/conflicts', 'ข้อขัดแย้ง'],
  ['/admin/chats', 'แชท'],
  ['/admin/history', 'ประวัติ'],
  ['/admin/book', 'หนังสือ'],
  ['/admin/trash', 'ถังขยะ'],
];

const when = (value) =>
  value
    ? new Date(value).toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        day: 'numeric',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

const bytes = (n) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(2)} GB`
    : n >= 1024 ** 2
      ? `${(n / 1024 ** 2).toFixed(1)} MB`
      : `${Math.max(1, Math.round(n / 1024))} KB`;

/** ทำให้ #12 ในข้อความกดไปดูกฎข้อนั้นในหน้ากฎได้ ไม่ว่าจะอยู่หน้าไหน */
const refs = (html) =>
  html.replace(/(?<!&)#(\d+)/g, (_m, id) => `<a class="ref" href="/admin/rules#rule-${id}">#${id}</a>`);

const text = (value) => refs(escape(value)).replace(/\n/g, '<br>');
const searchText = (...parts) => escape(parts.join(' ').toLowerCase());

/** ฟอร์มปุ่มเดียว ใช้กับทุกคำสั่งที่ไม่ต้องกรอกอะไร */
function button(action, label, { style = 'quiet', confirm } = {}) {
  return `<form method="post" action="${action}"${confirm ? ` data-confirm="${escape(confirm)}"` : ''}>
    <button class="btn ${style}">${label}</button>
  </form>`;
}

const trashButton = (action, confirm) =>
  button(action, 'ลบ', { style: 'danger-quiet', confirm: `${confirm} ย้ายไปถังขยะ กู้คืนได้จากหน้าถังขยะ` });

function hideButton(base, hidden) {
  return hidden
    ? button(`${base}/show`, 'แสดงในหนังสือ')
    : button(`${base}/hide`, 'ซ่อนจากหนังสือ');
}

// ---------- ข้อความแจ้งหลังทำงานเสร็จ ----------

const WHAT = {
  rule: ({ id }) => `ข้อ #${id} `,
  question: () => 'คำถาม',
  conflict: ({ id }) => `ข้อขัดแย้งเรื่องที่ ${id} `,
  message: () => 'ข้อความ',
};

const NOTICES = {
  edited: ({ id, to }) => `แก้ข้อ #${id} แล้ว ฉบับใหม่คือข้อ #${to} ส่วนฉบับเดิมเก็บไว้ในประวัติ`,
  unchanged: ({ id }) => `ข้อ #${id} ไม่มีอะไรเปลี่ยน จึงไม่ได้บันทึกฉบับใหม่`,
  retired: ({ id }) => `เลิกใช้ข้อ #${id} แล้ว ถ้าเปลี่ยนใจ กู้คืนได้จากส่วนกฎที่เลิกใช้ด้านล่าง`,
  restored: ({ id }) => `กู้คืนข้อ #${id} แล้ว กลับมาใช้ตามเดิม`,
  closed: () => 'ปิดคำถามแล้ว บอทจะไม่ถามข้อนี้อีก',
  cancelled: () => 'ยกเลิกเรื่องที่ขัดแย้งแล้ว บอทจะไม่ถามต่อและไม่ได้บันทึกอะไร',
  hidden: (p) => `ซ่อน${WHAT[p.what]?.(p) ?? ''}จากหนังสือแล้ว บอทยังใช้งานตามปกติ`,
  shown: (p) => `แสดง${WHAT[p.what]?.(p) ?? ''}ในหนังสือแล้ว`,
  trashed: (p) => `ย้าย${WHAT[p.what]?.(p) ?? ''}ไปถังขยะแล้ว บอทและหนังสือจะไม่เห็นอีก กู้คืนได้จากหน้าถังขยะ`,
  untrashed: () => 'กู้คืนจากถังขยะแล้ว กลับไปอยู่ที่เดิม',
  purged: ({ n }) => `ลบถาวรแล้ว ${n} รายการ`,
  saved: () => 'บันทึกการตั้งค่าหนังสือแล้ว เปิดหนังสือดูได้เลย',
};
const PROBLEMS = {
  invalid: () => 'ชื่อกฎกับเนื้อหาต้องไม่ว่าง ยังไม่ได้บันทึกอะไร',
  missing: () => 'ไม่พบรายการนี้ หรือมีคนเปลี่ยนไปก่อนแล้ว ดูสถานะล่าสุดด้านล่าง',
  error: () => 'ระบบขัดข้อง ยังไม่ได้บันทึกอะไร ลองใหม่อีกครั้ง',
  blocked: ({ id }) =>
    `ข้อความนี้เป็นต้นเรื่องของข้อขัดแย้งเรื่องที่ ${id} ต้องลบข้อขัดแย้งนั้นก่อน ถึงจะลบข้อความนี้ได้`,
  needs_message: () =>
    'กู้ข้อขัดแย้งนี้ไม่ได้ เพราะข้อความต้นเรื่องยังอยู่ในถังขยะ กู้ข้อความนั้นก่อนแล้วค่อยกู้ข้อขัดแย้ง',
};

function notice(query) {
  const make = NOTICES[query.done] ?? PROBLEMS[query.done];
  if (!make) return '';
  const params = {
    id: Number(query.id) || '?',
    to: Number(query.to) || '?',
    n: Number(query.n) || 0,
    what: String(query.what ?? ''),
  };
  const bad = Boolean(PROBLEMS[query.done]);
  return `<p class="flash${bad ? ' bad' : ''}" role="status">${refs(escape(make(params)))}</p>`;
}

// ---------- โครงหน้า ----------

export function shell({ tab, title, query = {}, body, search = false }) {
  const nav = TABS.map(
    ([href, label]) => `<a href="${href}"${href === tab ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');

  return `<!doctype html>
<html lang="th"${THEME_ATTR}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)} · ผู้ดูแล</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&family=Trirong:wght@500;600&display=swap" rel="stylesheet">
<style>${STYLE}${THEME_STYLE}${ADMIN_STYLE}</style>
</head>
<body class="admin">
<div class="sky" aria-hidden="true"><div class="dyes"></div></div>
<nav class="tabs" aria-label="เมนูผู้ดูแล">${nav}<a href="/" target="_blank" rel="noopener">เปิดหนังสือ ↗</a></nav>
<main>
  <p class="wordmark">${brandMark()}</p>
  <h1>${escape(title)}</h1>
  ${notice(query)}
  ${search ? '<input class="search" id="filter" type="search" placeholder="ค้นหา" aria-label="ค้นหา">' : ''}
  ${body}
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

// ---------- ภาพรวม ----------

/** ป้ายตัวเลขบนหน้าภาพรวม แต่ละใบมีแถบผ้าคนละสีคนละลายแบบเดียวกับปกบทในหนังสือ */
function tile([value, label, href], index) {
  return `<a class="tile" href="${href}"><span ${swatch(index)}></span>
    <strong>${value.toLocaleString('th-TH')}</strong><span>${label}</span></a>`;
}

export function overviewPage({ overview, timeline, query }) {
  const c = overview.counts;
  const used = c.db_bytes / STORAGE_LIMIT;
  const minutes = Math.round(c.voice_ms / 60000);

  const body = `
  <section class="tiles">
    ${[
      [c.rules_active, 'กฎที่ใช้อยู่', '/admin/rules'],
      [c.rules_retired, 'กฎที่เลิกใช้', '/admin/rules#retired'],
      [c.rules_hidden, 'กฎที่ซ่อนจากหนังสือ', '/admin/rules'],
      [c.questions_open, 'คำถามค้าง', '/admin/questions'],
      [c.questions_answered, 'คำถามที่ได้คำตอบ', '/admin/questions?status=answered'],
      [c.conflicts_open, 'ข้อขัดแย้งรอคำตอบ', '/admin/conflicts'],
      [c.users, 'ผู้ใช้', '/admin/chats'],
      [c.messages, 'ข้อความแชท', '/admin/chats'],
      [c.voices, `ข้อความเสียง (${minutes} นาที)`, '/admin/chats'],
      [c.trash, 'ในถังขยะ', '/admin/trash'],
    ]
      .map(tile)
      .join('')}
  </section>

  <section class="panel">
    <h2>พื้นที่ฐานข้อมูล</h2>
    <p><strong>${bytes(c.db_bytes)}</strong> จาก ${bytes(STORAGE_LIMIT)} (${(used * 100).toFixed(1)}%)</p>
    <div class="bar${used > 0.8 ? ' warn' : ''}"><span style="width:${Math.min(100, used * 100).toFixed(1)}%"></span></div>
    <p class="meta">ค่าประมาณจาก Postgres ตัวเลขจริงที่ Neon นับดูได้ที่หน้า Neon → Usage การลบถาวรจากถังขยะช่วยคืนพื้นที่ได้</p>
    <details>
      <summary>แยกตามตาราง</summary>
      <table class="sizes">
        ${overview.tables.map((t) => `<tr><td>${escape(t.name)}</td><td>${bytes(t.bytes)}</td></tr>`).join('')}
      </table>
    </details>
  </section>

  <section class="panel">
    <h2>ความเคลื่อนไหวล่าสุด</h2>
    ${timelineList(timeline)}
    <p><a href="/admin/history">ดูประวัติทั้งหมด →</a></p>
  </section>`;

  return shell({ tab: '/admin', title: 'ภาพรวม', query, body });
}

// ---------- กฎ ----------

function ruleItem(rule) {
  const base = `/admin/rules/${rule.id}`;
  return `<article class="rule" id="rule-${rule.id}"
      data-search="${searchText(`#${rule.id}`, rule.topic, rule.title, rule.summary, rule.author)}">
    <header>
      <span class="num">#${rule.id}</span><h4>${escape(rule.title)}</h4>
      ${rule.hidden ? '<span class="badge">ซ่อนจากหนังสือ</span>' : ''}
    </header>
    <p class="summary">${escape(rule.summary)}</p>
    <p class="meta">สอนโดย ${escape(rule.author)} · ${date(rule.created_at)}</p>
    <details>
      <summary>แก้ไข</summary>
      <form class="stack" method="post" action="${base}/edit">
        <label>บท <input name="topic" list="topics" value="${escape(rule.topic)}" maxlength="100" required></label>
        <label>ชื่อกฎ <input name="title" value="${escape(rule.title)}" maxlength="200" required></label>
        <label>เนื้อหา <textarea name="summary" rows="5" maxlength="4000" required>${escape(rule.summary)}</textarea></label>
        <label>แก้เพราะอะไร <input name="reason" maxlength="500" placeholder="เช่น ตัวเลขเดิมจดผิด ที่ถูกคือ 600 กิโล"></label>
        <p class="meta">ฉบับเดิมจะเก็บไว้ในประวัติ ส่วนฉบับที่แก้จะได้เลขข้อใหม่</p>
        <button class="btn">บันทึกฉบับใหม่</button>
      </form>
    </details>
    <details>
      <summary>เลิกใช้</summary>
      <form class="stack" method="post" action="${base}/retire" data-confirm="เลิกใช้ข้อ #${rule.id} ใช่ไหม">
        <label>เลิกใช้เพราะอะไร <input name="reason" maxlength="500" placeholder="เช่น ไม่ได้ทำแบบนี้แล้ว"></label>
        <p class="meta">กฎจะย้ายไปภาคผนวกของหนังสือพร้อมเหตุผล บอทจะไม่ใช้ตอบอีก และกู้คืนได้ภายหลัง</p>
        <button class="btn danger">เลิกใช้ข้อนี้</button>
      </form>
    </details>
    <div class="row">
      ${hideButton(base, rule.hidden)}
      ${trashButton(`${base}/trash`, `ลบข้อ #${rule.id} พร้อมประวัติและลิงก์ไปคำพูดต้นฉบับ?`)}
    </div>
  </article>`;
}

function retiredItem(rule, changes) {
  const base = `/admin/rules/${rule.id}`;
  const ending = retiredBy(rule.id, changes);
  return `<article class="rule retired" id="rule-${rule.id}"
      data-search="${searchText(`#${rule.id}`, rule.topic, rule.title, rule.summary, rule.author)}">
    <header>
      <span class="num">#${rule.id}</span><h4>${escape(rule.title)}</h4>
      <span class="badge">เลิกใช้ ${date(rule.retired_at)}</span>
      ${rule.hidden ? '<span class="badge">ซ่อนจากหนังสือ</span>' : ''}
    </header>
    <p class="summary">${escape(rule.summary)}</p>
    <p class="meta">[${escape(rule.topic)}] · สอนโดย ${escape(rule.author)} · ${date(rule.created_at)}</p>
    ${ending ? `<p class="meta">${refs(escape(retirementNote(ending)))}</p>` : ''}
    <details>
      <summary>กู้คืน</summary>
      <form class="stack" method="post" action="${base}/restore">
        <label>กู้คืนเพราะอะไร <input name="reason" maxlength="500" placeholder="เช่น เลิกใช้ผิดข้อ"></label>
        ${
          ending?.new_rule_ids.length
            ? '<p class="meta">ข้อนี้มีฉบับใหม่มาแทนแล้ว ถ้ากู้คืนจะมีทั้งสองข้อใช้พร้อมกัน ควรเลิกใช้ฉบับใหม่ด้วยถ้าไม่ต้องการ</p>'
            : ''
        }
        <button class="btn quiet">กู้คืนข้อนี้</button>
      </form>
    </details>
    <div class="row">
      ${hideButton(base, rule.hidden)}
      ${trashButton(`${base}/trash`, `ลบข้อ #${rule.id} พร้อมประวัติ?`)}
    </div>
  </article>`;
}

export function rulesPage({ rules, changes, query }) {
  const active = rules.filter((r) => r.status === 'active');
  const retired = rules
    .filter((r) => r.status === 'retired')
    .sort((a, b) => new Date(b.retired_at) - new Date(a.retired_at));

  const byTopic = new Map();
  for (const rule of active) {
    if (!byTopic.has(rule.topic)) byTopic.set(rule.topic, []);
    byTopic.get(rule.topic).push(rule);
  }
  const topics = [...byTopic.keys()].sort((a, b) => a.localeCompare(b, 'th'));

  const body = `
  <p class="meta">กฎที่ใช้อยู่ ${active.length} ข้อ · เลิกใช้แล้ว ${retired.length} ข้อ ·
    "ซ่อนจากหนังสือ" = บอทยังใช้ตอบ แค่ไม่ขึ้นในหนังสือ · "ลบ" = บอทและหนังสือไม่เห็นอีก (กู้คืนได้จากถังขยะ)</p>
  ${
    topics.length
      ? topics
          .map(
            (topic) => `<section class="topic">
              <h2>${escape(topic)} <span class="meta">${byTopic.get(topic).length} ข้อ</span></h2>
              ${byTopic.get(topic).map(ruleItem).join('')}
            </section>`,
          )
          .join('')
      : '<p class="note">ยังไม่มีกฎที่ใช้อยู่</p>'
  }
  ${
    retired.length
      ? `<section class="topic" id="retired">
          <details class="group">
            <summary>กฎที่เลิกใช้แล้ว (${retired.length})</summary>
            ${retired.map((r) => retiredItem(r, changes)).join('')}
          </details>
        </section>`
      : ''
  }
  <datalist id="topics">${topics.map((t) => `<option value="${escape(t)}">`).join('')}</datalist>`;

  return shell({ tab: '/admin/rules', title: 'กฎ', query, body, search: true });
}

// ---------- คำถาม ----------

const QUESTION_STATUS = {
  open: ['ค้างอยู่', 'warn'],
  answered: ['ได้คำตอบแล้ว', 'ok'],
  skipped: ['ข้ามไป', ''],
};

function questionItem(q) {
  const base = `/admin/questions/${q.id}`;
  const ruleRefs = (q.rule_ids ?? []).map((id) => `#${id}`).join(' ');
  const [statusLabel, statusStyle] = QUESTION_STATUS[q.status] ?? [q.status, ''];
  const asked = q.asked_at
    ? `ถาม ${escape(q.author)} ไปแล้ว ${q.asked_count} ครั้ง ล่าสุด ${when(q.asked_at)}`
    : `ยังไม่ได้ถาม ${escape(q.author)}`;

  return `<article class="item" data-search="${searchText(q.topic, q.question, ruleRefs, q.author, q.answer_text ?? '')}">
    <header>
      <span class="badge ${statusStyle}">${statusLabel}</span>
      ${q.hidden ? '<span class="badge">ซ่อนจากหนังสือ</span>' : ''}
      <span class="meta">[${escape(q.topic)}]${ruleRefs ? ` · ข้อ ${refs(ruleRefs)}` : ''}</span>
    </header>
    <p>${text(q.question)}</p>
    ${q.answer_text ? `<blockquote><p>${text(q.answer_text)}</p></blockquote>` : ''}
    <p class="meta">${asked} · สร้าง ${when(q.created_at)}</p>
    <div class="row">
      ${q.status === 'open' ? button(`${base}/close`, 'ปิดคำถามนี้') : ''}
      ${hideButton(base, q.hidden)}
      ${trashButton(`${base}/trash`, 'ลบคำถามนี้?')}
    </div>
  </article>`;
}

export function questionsPage({ questions, status, query }) {
  const filters = [
    ['open', 'ค้างอยู่'],
    ['answered', 'ได้คำตอบแล้ว'],
    ['skipped', 'ข้ามไป'],
    ['all', 'ทั้งหมด'],
  ]
    .map(
      ([key, label]) =>
        `<a href="/admin/questions?status=${key}"${key === status ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');

  const body = `
  <p class="meta">ช่องโหว่ที่บอทหาเจอแล้วถามผู้สอนใน LINE คำถามค้างจะขึ้นในกล่อง "สิ่งที่ยังไม่ชัด" ท้ายบทของหนังสือ
    ถ้าไม่อยากให้ขึ้นในหนังสือแต่ยังอยากให้บอทถามต่อ ให้กด "ซ่อนจากหนังสือ" ถ้าไม่ต้องถามแล้วให้กด "ปิดคำถามนี้"</p>
  <nav class="filters">${filters}</nav>
  ${questions.length ? questions.map(questionItem).join('') : '<p class="note">ไม่มีคำถามในกลุ่มนี้</p>'}`;

  return shell({ tab: '/admin/questions', title: 'คำถาม', query, body, search: true });
}

// ---------- ข้อขัดแย้ง ----------

const CONFLICT_STATUS = {
  open: ['รอคำตอบ', 'warn'],
  resolved: ['ตัดสินแล้ว', 'ok'],
  cancelled: ['ยกเลิก', ''],
};

function conflictItem(c) {
  const base = `/admin/conflicts/${c.id}`;
  const [statusLabel, statusStyle] = CONFLICT_STATUS[c.status] ?? [c.status, ''];
  return `<article class="item" id="conflict-${c.id}"
      data-search="${searchText(c.explanation, c.question, c.original_text, c.author, c.decision ?? '')}">
    <header>
      <span class="badge ${statusStyle}">${statusLabel}</span>
      <span class="meta">เรื่องที่ ${c.id} · ${escape(c.author)} · ${when(c.created_at)}</span>
    </header>
    <p><strong>ขัดกันตรงไหน:</strong> ${text(c.explanation)}</p>
    <p class="label">ผู้สอนพูดมา</p>
    <blockquote><p>${text(c.original_text)}</p></blockquote>
    <p class="label">บอทถามกลับ</p>
    <p>${text(c.question)}</p>
    ${c.answer_text ? `<p class="label">ผู้สอนตอบ</p><blockquote><p>${text(c.answer_text)}</p></blockquote>` : ''}
    ${c.decision ? `<p><strong>ข้อสรุป:</strong> ${text(c.decision)}</p>` : ''}
    <div class="row">
      ${
        c.status === 'open'
          ? button(`${base}/cancel`, 'ยกเลิกเรื่องนี้', {
              confirm: 'ยกเลิกเรื่องนี้ใช่ไหม บอทจะไม่ถามต่อและจะไม่บันทึกสิ่งที่สอนมาในเรื่องนี้',
            })
          : ''
      }
      ${trashButton(`${base}/trash`, 'ลบเรื่องนี้ออกจากประวัติ?')}
    </div>
  </article>`;
}

export function conflictsPage({ conflicts, query }) {
  const body = `
  <p class="meta">เรื่องที่รอคำตอบ ระหว่างรอบอทจะไม่ถามคำถามอื่นกับผู้สอนคนนั้น ถ้าไม่ต้องการแล้วยกเลิกได้
    ส่วนเรื่องที่ตัดสินแล้วจะขึ้นในภาคผนวก ก ของหนังสือ</p>
  ${conflicts.length ? conflicts.map(conflictItem).join('') : '<p class="note">ยังไม่เคยมีข้อขัดแย้ง</p>'}`;

  return shell({ tab: '/admin/conflicts', title: 'ข้อขัดแย้ง', query, body, search: true });
}

// ---------- แชท ----------

export function usersPage({ users, teachers, query }) {
  const items = users.map(
    (u) => `<a class="item user" href="/admin/chats/${encodeURIComponent(u.user_id)}"
        data-search="${searchText(u.name, u.user_id, u.last_text ?? '')}">
      <header>
        <strong>${escape(u.name)}</strong>
        ${teachers.has(u.user_id) ? '<span class="badge ok">สอนได้</span>' : ''}
        <span class="meta">${u.messages} ข้อความ · สอนไว้ ${u.rules} ข้อ</span>
      </header>
      ${u.last_text ? `<p class="preview">${escape(u.last_text)}</p>` : ''}
      <p class="meta">${u.last_at ? `ล่าสุด ${when(u.last_at)} · ` : ''}<code>${escape(u.user_id)}</code></p>
    </a>`,
  );

  const body = `
  <p class="meta">ทุกคนที่เคยคุยกับบอท กดเพื่อดูแชททั้งหมดและฟังเสียงต้นฉบับ</p>
  ${items.length ? items.join('') : '<p class="note">ยังไม่มีใครคุยกับบอท</p>'}`;

  return shell({ tab: '/admin/chats', title: 'แชท', query, body, search: true });
}

function bubble(m) {
  const mine = m.role === 'user';
  const sources = m.rule_ids.length
    ? `<p class="meta">ที่มาของ ${refs(m.rule_ids.map((id) => `#${id}`).join(' '))}</p>`
    : '';
  return `<article class="bubble ${mine ? 'user' : 'bot'}" id="m-${m.id}" data-search="${searchText(m.text)}">
    ${m.has_audio ? `<p class="label">🎤 ข้อความเสียง${m.duration_ms ? ` ${Math.round(m.duration_ms / 1000)} วินาที` : ''}</p>
      <audio controls preload="none" src="/admin/audio/${m.id}"></audio>` : ''}
    <p>${escape(m.text).replace(/\n/g, '<br>') || '<em>(ถอดเสียงไม่ออก)</em>'}</p>
    ${sources}
    <footer>
      <span class="meta">${mine ? '' : 'บอท · '}${when(m.created_at)}</span>
      <form method="post" action="/admin/messages/${m.id}/trash"
          data-confirm="ลบข้อความนี้${m.has_audio ? 'พร้อมไฟล์เสียง' : ''}?${m.rule_ids.length ? ' กฎที่อ้างข้อความนี้จะไม่มีต้นฉบับให้ดู' : ''} ย้ายไปถังขยะ กู้คืนได้">
        <button class="link">ลบ</button>
      </form>
    </footer>
  </article>`;
}

export function chatPage({ user, userId, messages, hasMore, teachers, query }) {
  const name = user?.display_name ?? 'ไม่ทราบชื่อ';
  const older = hasMore
    ? `<p><a href="?before=${messages[0].id}">← ข้อความก่อนหน้า</a></p>`
    : '';

  const body = `
  <p class="meta"><a href="/admin/chats">← ผู้ใช้ทั้งหมด</a> · <code>${escape(userId)}</code>
    ${teachers.has(userId) ? '· <span class="badge ok">สอนได้</span>' : ''}</p>
  ${older}
  <section class="chat">
    ${messages.length ? messages.map(bubble).join('') : '<p class="note">ไม่มีข้อความ</p>'}
  </section>`;

  return shell({ tab: '/admin/chats', title: `แชทกับ ${name}`, query, body, search: true });
}

// ---------- ประวัติ ----------

const TIMELINE_LABELS = {
  teach: 'สอนกฎใหม่',
  refine: 'เพิ่มรายละเอียด',
  conflict: 'ตัดสินข้อขัดแย้ง',
};

function timelineList(entries) {
  if (entries.length === 0) return '<p class="note">ยังไม่มีความเคลื่อนไหว</p>';
  const items = entries.map((e) => {
    const admin = e.kind.startsWith('admin:');
    const label = admin ? e.kind.slice('admin:'.length) : (TIMELINE_LABELS[e.kind] ?? e.kind);
    return `<li data-search="${searchText(label, e.detail, e.author)}">
      <span class="meta">${when(e.created_at)}</span>
      <span><span class="badge${admin ? ' warn' : ''}">${escape(label)}</span> ${escape(e.author)}</span>
      <span>${text(e.detail)}</span>
    </li>`;
  });
  return `<ul class="timeline">${items.join('')}</ul>`;
}

export function historyPage({ timeline, limit, query }) {
  const body = `
  <p class="meta">ทุกอย่างที่เปลี่ยน ทั้งที่ผู้สอนทำผ่าน LINE และที่ผู้ดูแลทำจากหน้านี้ ใหม่สุดอยู่บน</p>
  ${timelineList(timeline)}
  ${timeline.length >= limit ? `<p><a href="?limit=${limit * 2}">ดูเพิ่ม →</a></p>` : ''}`;

  return shell({ tab: '/admin/history', title: 'ประวัติ', query, body, search: true });
}

// ---------- การสอน ----------
//
// วันในปฏิทินเป็นสตริง YYYY-MM-DD ตามเวลาไทยที่ฐานข้อมูลคิดมาให้แล้ว
// ที่นี่คิดเลขวันด้วย UTC ล้วน ๆ เขตเวลาของเครื่องเซิร์ฟเวอร์จะได้ไม่ทำให้วันเลื่อน

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
// เปิดหน้ามาเห็นย้อนหลังแค่ปีเดียวพอ ที่เก่ากว่านั้นกดดูทั้งหมดได้
const MONTHS_SHOWN = 12;
const DAY_MS = 86_400_000;

const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const utcOf = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const dayName = (key, options) =>
  new Date(utcOf(key)).toLocaleDateString('th-TH', { timeZone: 'UTC', ...options });
const longDay = (key) => dayName(key, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const clock = (value) =>
  new Date(value).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

function ago(key, today) {
  const n = Math.round((utcOf(today) - utcOf(key)) / DAY_MS);
  return n === 0 ? 'วันนี้' : n === 1 ? 'เมื่อวาน' : `${n} วันที่แล้ว`;
}

/** สิ่งที่ผู้สอนทำในวันนั้น เช่น "12 ข้อความ (เสียง 3) · บันทึกกฎ 4 ข้อ" */
function didWhat({ messages, voices, rules, answered }) {
  return [
    messages ? `${messages} ข้อความ${voices ? ` (เสียง ${voices})` : ''}` : '',
    rules ? `บันทึกกฎ ${rules} ข้อ` : '',
    answered ? `ตอบคำถาม ${answered} ข้อ` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** รวมแถวของแต่ละคนให้เป็นรายวัน แถวมาเรียงจากวันล่าสุดแล้ว */
function groupDays(rows) {
  const days = new Map();
  for (const row of rows) {
    if (!days.has(row.day)) {
      days.set(row.day, { key: row.day, messages: 0, voices: 0, rules: 0, answered: 0, people: [] });
    }
    const day = days.get(row.day);
    for (const k of ['messages', 'voices', 'rules', 'answered']) day[k] += row[k];
    day.people.push(row);
  }
  return [...days.values()];
}

/** เดือนตั้งแต่เดือนนี้ย้อนไปถึงเดือนของ oldest (YYYY-MM) ใหม่สุดก่อน */
function monthsBack(today, oldest, limit) {
  let [y, m] = today.split('-').map(Number);
  const months = [];
  while (months.length < limit) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    months.push(key);
    if (key <= oldest) break;
    m -= 1;
    if (m === 0) [y, m] = [y - 1, 12];
  }
  return months;
}

/** ความเข้มของสี 1-4 ตามจำนวนข้อความ เทียบกับวันที่ส่งมามากที่สุด */
const levelOf = (messages, max) => Math.min(4, Math.max(1, Math.ceil((messages / max) * 4)));

function monthCalendar(month, byDay, today, max) {
  const [y, m] = month.split('-').map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let active = 0;

  const cells = [];
  for (let d = 1; d <= length; d += 1) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    const day = byDay.get(key);
    const isToday = key === today;
    const now = isToday ? ' aria-current="date"' : '';
    if (!day) {
      const cls = `d${isToday ? ' today' : ''}${key > today ? ' future' : ''}`;
      cells.push(`<span class="${cls}"${now}>${d}</span>`);
      continue;
    }
    active += 1;
    const lines = day.people.map((p) => `${p.name} · ${didWhat(p)}`);
    const tip = [longDay(key), ...lines].join('\n');
    cells.push(
      `<a class="d l${levelOf(day.messages, max)}${isToday ? ' today' : ''}" href="#day-${key}"${now}
        data-tip="${escape(tip)}" aria-label="${escape(`${longDay(key)}: ${lines.join(', ')}`)}">${d}</a>`,
    );
  }

  const blanks = '<span class="blank"></span>'.repeat(lead);
  const header = WEEKDAYS.map((w) => `<span class="wd">${w}</span>`).join('');
  return `<section class="month">
    <h3>${dayName(`${month}-01`, { month: 'long', year: 'numeric' })}
      <span class="meta">${active ? `สอน ${active} วัน` : 'ไม่มีการสอน'}</span></h3>
    <div class="cal">${header}${blanks}${cells.join('')}</div>
  </section>`;
}

function dayEntry(day, today) {
  const people = day.people.map((p) => {
    // เปิดแชทของคนนี้ให้จบที่ข้อความสุดท้ายของวันนั้น แล้วเลื่อนไปที่ข้อความแรกของวัน
    const chat = p.first_id
      ? `/admin/chats/${encodeURIComponent(p.user_id)}?before=${p.last_id + 1}#m-${p.first_id}`
      : '';
    const time = p.first_at
      ? clock(p.first_at) === clock(p.last_at)
        ? clock(p.first_at)
        : `${clock(p.first_at)}–${clock(p.last_at)}`
      : '';
    return `<li>
      <strong>${escape(p.name)}</strong>
      <span>${escape(didWhat(p))}</span>
      <span class="meta">${time ? `${time} น.` : ''}${chat ? `${time ? ' · ' : ''}<a href="${chat}">ดูแชทวันนี้ →</a>` : ''}</span>
    </li>`;
  });

  return `<article class="item day-entry" id="day-${day.key}">
    <header><strong>${longDay(day.key)}</strong><span class="meta">${ago(day.key, today)}</span></header>
    <ul class="people">${people.join('')}</ul>
  </article>`;
}

export function teachingPage({ rows, who, all, query }) {
  const today = todayKey();

  // รายชื่อผู้สอนสำหรับปุ่มกรอง เรียงจากคนที่เข้ามาสอนหลายวันที่สุด
  const teachers = new Map();
  for (const row of rows) {
    const t = teachers.get(row.user_id) ?? { id: row.user_id, name: row.name, days: 0 };
    t.days += 1;
    teachers.set(row.user_id, t);
  }
  const person = teachers.get(who) ?? null;
  const days = groupDays(person ? rows.filter((r) => r.user_id === person.id) : rows);

  const oldest = days.at(-1)?.key.slice(0, 7) ?? today.slice(0, 7);
  const everyMonth = monthsBack(today, oldest, Infinity);
  const months = all ? everyMonth : everyMonth.slice(0, MONTHS_SHOWN);
  const shown = days.filter((d) => d.key.slice(0, 7) >= months.at(-1));

  const byDay = new Map(days.map((d) => [d.key, d]));
  const max = Math.max(1, ...days.map((d) => d.messages));
  const thisMonth = days.filter((d) => d.key.startsWith(today.slice(0, 7))).length;
  const rules = days.reduce((sum, d) => sum + d.rules, 0);
  const latest = days[0];

  const link = (params) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return escape(`/admin/teaching${search ? `?${search}` : ''}`);
  };
  const range = all ? 'all' : '';
  const filters =
    teachers.size > 1
      ? `<nav class="filters" aria-label="เลือกผู้สอน">
          <a href="${link({ range })}"${person ? '' : ' aria-current="page"'}>ทุกคน</a>
          ${[...teachers.values()]
            .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'th'))
            .map(
              (t) => `<a href="${link({ who: t.id, range })}"${t === person ? ' aria-current="page"' : ''}>
                ${escape(t.name)} <span class="meta">${t.days} วัน</span></a>`,
            )
            .join('')}
        </nav>`
      : '';

  const stats = [
    [days.length.toLocaleString('th-TH'), 'วันที่เข้ามาสอนทั้งหมด'],
    [thisMonth.toLocaleString('th-TH'), `วันที่สอนใน${dayName(`${today.slice(0, 7)}-01`, { month: 'long' })}`],
    [latest ? ago(latest.key, today) : '–', latest ? `สอนล่าสุด · ${longDay(latest.key)}` : 'ยังไม่เคยสอน'],
    [rules.toLocaleString('th-TH'), 'กฎที่บันทึกจากการสอน'],
  ]
    .map(
      ([value, label], i) => `<div class="tile"><span ${swatch(i)}></span>
        <strong>${escape(value)}</strong><span>${escape(label)}</span></div>`,
    )
    .join('');

  const legend = `<p class="legend" aria-hidden="true">น้อย
    <i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> มาก</p>`;

  const body = `
  <p class="meta">วันที่ผู้สอนเข้ามาคุยกับบอทใน LINE (นับตามเวลาไทย) สีเข้มตามจำนวนข้อความที่ส่งมาในวันนั้น
    ${days.length ? `มากสุด ${max} ข้อความต่อวัน ` : ''}กดวันในปฏิทินเพื่อดูรายละเอียดด้านล่าง</p>
  ${filters}
  <section class="tiles stats">${stats}</section>

  <section class="panel">
    <div class="cal-head"><h2>ปฏิทินการสอน${person ? ` · ${escape(person.name)}` : ''}</h2>${legend}</div>
    <div class="months">${months.map((m) => monthCalendar(m, byDay, today, max)).join('')}</div>
    ${
      everyMonth.length > months.length
        ? `<p><a href="${link({ who: person?.id, range: 'all' })}">ดูย้อนหลังทั้งหมด (${everyMonth.length} เดือน) →</a></p>`
        : ''
    }
  </section>

  <section class="topic">
    <h2>รายวัน${shown.length ? ` <span class="meta">${shown.length} วัน ใหม่สุดอยู่บน</span>` : ''}</h2>
    ${shown.length ? shown.map((d) => dayEntry(d, today)).join('') : '<p class="note">ยังไม่มีใครเข้ามาสอนในช่วงนี้</p>'}
  </section>
  <div class="tip" role="tooltip" hidden></div>`;

  return shell({ tab: '/admin/teaching', title: 'การสอน', query, body });
}

// ---------- หนังสือ ----------

export function bookPage({ settings, topics, hiddenRules, hiddenQuestions, query }) {
  const hiddenTopics = new Set(settings.hiddenTopics);
  // บทที่ซ่อนไว้แต่ตอนนี้ไม่มีกฎแล้ว (เช่นเปลี่ยนชื่อบท) ยังต้องโชว์ให้กดเลิกซ่อนได้
  const all = [
    ...topics,
    ...settings.hiddenTopics.filter((t) => !topics.some((x) => x.topic === t)).map((topic) => ({ topic, count: 0 })),
  ];

  const sections = BOOK_SECTIONS.map(
    ({ key, label }) => `<label class="check">
      <input type="checkbox" name="${key}" value="1"${settings.sections[key] ? ' checked' : ''}> ${escape(label)}
    </label>`,
  ).join('');

  const chapterRows = all.map(
    ({ topic, count }) => `<li>
      <span>${escape(topic)} <span class="meta">${count} ข้อ</span>
        ${hiddenTopics.has(topic) ? '<span class="badge">ซ่อนอยู่</span>' : ''}</span>
      <form method="post" action="/admin/book/topics">
        <input type="hidden" name="topic" value="${escape(topic)}">
        <input type="hidden" name="hidden" value="${hiddenTopics.has(topic) ? '0' : '1'}">
        <button class="btn quiet">${hiddenTopics.has(topic) ? 'แสดงบทนี้' : 'ซ่อนบทนี้'}</button>
      </form>
    </li>`,
  );

  const body = `
  <section class="panel">
    <h2>ส่วนที่แสดงในหนังสือ</h2>
    <form class="stack" method="post" action="/admin/book/sections">
      ${sections}
      <button class="btn">บันทึก</button>
    </form>
    <p class="meta">ปิดปุ่มฟังเสียงแล้ว ลิงก์ไฟล์เสียงที่เคยแจกไปจะฟังไม่ได้ด้วย</p>
  </section>

  <section class="panel">
    <h2>บท</h2>
    <p class="meta">ซ่อนทั้งบทออกจากหนังสือ กฎในบทนั้นบอทยังใช้ตอบตามปกติ</p>
    ${chapterRows.length ? `<ul class="chapters">${chapterRows.join('')}</ul>` : '<p class="note">ยังไม่มีบท</p>'}
  </section>

  <section class="panel">
    <h2>ซ่อนทีละข้อ</h2>
    <p>ตอนนี้ซ่อนกฎไว้ <strong>${hiddenRules}</strong> ข้อ และคำถาม <strong>${hiddenQuestions}</strong> ข้อ</p>
    <p class="meta">กดปุ่ม "ซ่อนจากหนังสือ" ได้ที่หน้า <a href="/admin/rules">กฎ</a> และ <a href="/admin/questions?status=all">คำถาม</a></p>
  </section>`;

  return shell({ tab: '/admin/book', title: 'ตั้งค่าหนังสือ', query, body });
}

// ---------- ถังขยะ ----------

const TRASH_KINDS = { rule: 'กฎ', question: 'คำถาม', conflict: 'ข้อขัดแย้ง', message: 'ข้อความแชท' };

export function trashPage({ items, query }) {
  const rows = items.map(
    (t) => `<article class="item" data-search="${searchText(TRASH_KINDS[t.kind], t.label)}">
      <header>
        <span class="badge">${TRASH_KINDS[t.kind] ?? t.kind}</span>
        <span class="meta">ลบเมื่อ ${when(t.deleted_at)}</span>
      </header>
      <p>${escape(t.label)}</p>
      <div class="row">
        ${button(`/admin/trash/${t.id}/restore`, 'กู้คืน')}
        ${button(`/admin/trash/${t.id}/purge`, 'ลบถาวร', {
          style: 'danger-quiet',
          confirm: 'ลบถาวรใช่ไหม รายการนี้จะหายจากฐานข้อมูลและกู้คืนไม่ได้อีก',
        })}
      </div>
    </article>`,
  );

  const body = `
  <p class="meta">ของที่ลบแล้วบอทและหนังสือไม่เห็นแล้ว แต่ยังกู้คืนได้จนกว่าจะกดลบถาวร</p>
  ${
    items.length
      ? `<div class="row">${button('/admin/trash/empty', `ลบถาวรทั้งหมด (${items.length})`, {
          style: 'danger',
          confirm: `ลบถาวรทั้ง ${items.length} รายการใช่ไหม กู้คืนไม่ได้อีก`,
        })}</div>
         ${rows.join('')}`
      : '<p class="note">ถังขยะว่าง</p>'
  }`;

  return shell({ tab: '/admin/trash', title: 'ถังขยะ', query, body, search: true });
}

// ---------- สคริปต์และหน้าตา ----------

const SCRIPT = `
  document.addEventListener('submit', (e) => {
    const message = e.target.dataset.confirm;
    if (message && !confirm(message)) e.preventDefault();
  });

  const box = document.getElementById('filter');
  box?.addEventListener('input', () => {
    const q = box.value.trim().toLowerCase();
    document.querySelectorAll('[data-search]').forEach((el) => {
      el.hidden = Boolean(q) && !el.dataset.search.includes(q);
    });
    document.querySelectorAll('.topic').forEach((group) => {
      group.hidden = Boolean(q) && !group.querySelector('[data-search]:not([hidden])');
    });
    if (q) document.querySelectorAll('details.group').forEach((d) => (d.open = true));
  });

  // เลื่อนไปที่รายการที่เพิ่งทำ ถ้ามันอยู่ในส่วนที่พับไว้ต้องกางออกก่อนถึงจะเลื่อนไปถูก
  function reveal() {
    try {
      const target = location.hash && document.querySelector(location.hash);
      if (!target) return;
      target.closest('details.group')?.setAttribute('open', '');
      target.scrollIntoView();
    } catch {}
  }
  reveal();
  addEventListener('hashchange', reveal);

  // ป้ายบอกรายละเอียดตอนชี้หรือเลื่อนโฟกัสไปที่วันในปฏิทิน ใช้ป้ายเดียวย้ายไปมา
  const tip = document.querySelector('.tip');
  if (tip) {
    const show = (el) => {
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const box = el.getBoundingClientRect();
      const size = tip.getBoundingClientRect();
      const left = Math.max(8, Math.min(box.left + box.width / 2 - size.width / 2, innerWidth - size.width - 8));
      const top = box.top - size.height - 8 < 8 ? box.bottom + 8 : box.top - size.height - 8;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    };
    const toggle = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (el) show(el);
      else tip.hidden = true;
    };
    document.addEventListener('pointerover', toggle);
    document.addEventListener('focusin', toggle);
    document.addEventListener('focusout', () => (tip.hidden = true));
    addEventListener('scroll', () => (tip.hidden = true), { passive: true });
  }
`;

const ADMIN_STYLE = `
:root { --danger: #a3302a; --danger-soft: #f8e1de; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --danger: #f08a80; --danger-soft: #3d1f1c; }
}
:root[data-theme="dark"] { --danger: #f08a80; --danger-soft: #3d1f1c; }
/* พื้นหลังน้ำย้อมชุดเดียวกับหนังสือ ตรึงไว้หลังเนื้อหาทั้งหน้า */
.admin .sky { position: fixed; inset: 0; z-index: -1; overflow: hidden; }
.admin main { max-width: 880px; padding-top: 28px; }
.admin h1 { font-size: 1.9rem; margin-bottom: 14px; }
.admin h2 { font-size: 1.3rem; }
.tabs {
  position: sticky; top: 0; z-index: 2; display: flex; gap: 4px; overflow-x: auto;
  padding: 8px 16px; background: var(--glass); border-bottom: 1px solid var(--glass-line);
  -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3);
}
/* แผ่นเนื้อหาทุกแบบเป็นแก้วทึบลอยเหนือพื้นหลัง ไม่เบลอฉากหลังจริงเพราะหน้ายาวและมีหลายร้อยชิ้น */
.item, .panel, .tile, .bubble, .admin .rule {
  background: var(--glass-dense); border-color: var(--glass-line);
  box-shadow: 0 18px 40px -30px var(--glass-shadow);
}
.tabs a, .filters a {
  flex: none; padding: 4px 12px; border-radius: 999px; text-decoration: none; color: var(--muted);
}
.tabs a[aria-current], .filters a[aria-current] { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.tabs a:last-child { margin-left: auto; }
.filters { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 12px; }
.flash { background: var(--ok-soft); color: var(--ok); border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; }
.flash.bad { background: var(--danger-soft); color: var(--danger); }
.admin .search {
  position: sticky; top: 56px; z-index: 1; margin-bottom: 8px; border-radius: 999px; padding: 9px 18px;
  background: var(--glass-dense); border-color: var(--glass-line);
  box-shadow: 0 10px 30px -18px var(--glass-shadow);
}
.topic { margin-top: 32px; }
.topic > h2 { margin-bottom: 4px; }
.group > summary { font-size: 1.15rem; font-weight: 600; }
.item {
  display: block; background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
  padding: 14px 18px; margin: 10px 0; color: inherit; text-decoration: none;
}
.item[hidden], .rule[hidden], .bubble[hidden], .timeline li[hidden] { display: none; }
.item header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 6px; }
a.item:hover { border-color: var(--accent); }
.preview { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 4px; }
code { font-size: .8rem; color: var(--muted); word-break: break-all; }
.row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.stack { display: grid; gap: 10px; margin: 10px 0 4px; }
.stack label { display: grid; gap: 4px; font-size: .9rem; color: var(--muted); }
.stack .meta { margin: 0; }
label.check { display: flex; gap: 10px; align-items: center; color: var(--ink); font-size: 1rem; }
label.check input { width: 18px; height: 18px; accent-color: var(--accent); }
input:not([type=checkbox]), textarea {
  width: 100%; font: inherit; color: var(--ink); background: var(--bg);
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px;
}
input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
textarea { resize: vertical; line-height: 1.6; }
.btn {
  justify-self: start; font: inherit; font-size: .92rem; font-weight: 600; cursor: pointer;
  border: 0; border-radius: 999px; padding: 6px 18px;
  background: var(--accent); color: var(--paper);
}
.btn.danger { background: var(--danger); }
.btn.quiet { background: var(--accent-soft); color: var(--accent); }
.btn.danger-quiet { background: var(--danger-soft); color: var(--danger); }
button.link { font: inherit; font-size: .82rem; background: none; border: 0; padding: 0; color: var(--danger); cursor: pointer; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 24px; }
.tile {
  display: grid; gap: 2px; padding: 14px 16px; border-radius: 12px; text-decoration: none;
  background: var(--paper); border: 1px solid var(--line); color: var(--muted); font-size: .9rem;
}
.tile strong { font: 600 1.9rem/1.2 'Trirong', 'Sarabun', serif; color: var(--ink); }
.tile .swatch { height: 7px; margin-bottom: 8px; border-radius: 999px; box-shadow: none; }
.tile .swatch::after { content: none; }
.tile:hover { border-color: var(--accent); }
.panel { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 18px 22px; margin-bottom: 20px; }
.panel h2 { margin-bottom: 10px; }
.bar { height: 10px; border-radius: 999px; background: var(--line); overflow: hidden; margin-bottom: 10px; }
.bar span { display: block; height: 100%; background: var(--ok); }
.bar.warn span { background: var(--danger); }
.sizes { border-collapse: collapse; margin-top: 8px; font-size: .9rem; }
.sizes td { padding: 2px 16px 2px 0; }
.sizes td:last-child { text-align: right; color: var(--muted); }
.timeline { list-style: none; padding: 0; margin: 0; }
.timeline li { display: grid; gap: 2px; padding: 10px 0; border-bottom: 1px dashed var(--line); }
.timeline li:last-child { border-bottom: 0; }
.chapters { list-style: none; padding: 0; margin: 0; }
.chapters li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--line); }
.chapters li:last-child { border-bottom: 0; }
.chat { display: grid; gap: 10px; }
.bubble { max-width: 85%; padding: 10px 14px; border-radius: 14px; background: var(--paper); border: 1px solid var(--line); }
.bubble.user { justify-self: start; border-bottom-left-radius: 4px; }
.bubble.bot { justify-self: end; background: var(--accent-soft); border-color: transparent; box-shadow: none; border-bottom-right-radius: 4px; }
.bubble p { margin-bottom: 4px; }
.bubble footer { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }

/* ---------- หน้าการสอน ---------- */
.stats { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.stats .tile strong { font-size: 1.6rem; }
@media (max-width: 480px) { .stats .tile strong { font-size: 1.3rem; } }
.stats .tile:hover { border-color: var(--glass-line); }
.filters .meta { font-size: .8rem; }
.cal-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; margin-bottom: 14px; }
.cal-head h2 { margin: 0; }
.legend { display: flex; align-items: center; gap: 4px; margin: 0; font-size: .85rem; color: var(--muted); }
.legend i { width: 14px; height: 14px; border-radius: 4px; }
.months { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 24px 32px; margin-bottom: 8px; }
.month h3 { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 0 0 8px; font-size: 1.02rem; }
.month h3 .meta { font-size: .82rem; font-weight: 400; }
.cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.cal .wd { text-align: center; font-size: .75rem; color: var(--muted); }
.cal .d {
  aspect-ratio: 1; display: grid; place-items: center; border-radius: 8px;
  font-size: .85rem; color: var(--muted); text-decoration: none; font-variant-numeric: tabular-nums;
}
.cal .future { opacity: .45; }
.cal a.d { font-weight: 700; transition: transform .12s, filter .12s; }
.cal a.d:hover, .cal a.d:focus-visible { transform: translateY(-1px); filter: brightness(1.18); outline: none; }
.cal .today { outline: 2px solid var(--ink); outline-offset: 2px; color: var(--ink); }
/* สีเดียวไล่จากจางไปเข้มตามจำนวนข้อความ ผสมจากสีหลักของธีมกับพื้นแผ่น ใช้ได้ทั้งจอมืดและตอนพิมพ์ */
.l1 { background: color-mix(in oklab, var(--accent) 44%, var(--paper)); }
.l2 { background: color-mix(in oklab, var(--accent) 66%, var(--paper)); }
.l3 { background: color-mix(in oklab, var(--accent) 84%, var(--paper)); }
.l4 { background: var(--accent); }
.cal .d.l1 { color: var(--ink); }
.cal .d.l2, .cal .d.l3, .cal .d.l4 { color: var(--paper); }
@media print { .cal .d.l2 { color: var(--ink); } }
.day-entry { scroll-margin-top: 70px; }
.day-entry:target { border-color: var(--accent); }
.people { list-style: none; padding: 0; margin: 0; }
.people li { display: grid; gap: 2px; padding: 8px 0; border-top: 1px dashed var(--line); }
.people li:first-child { border-top: 0; padding-top: 2px; }
.tip {
  position: fixed; z-index: 5; max-width: min(320px, calc(100vw - 16px)); pointer-events: none;
  padding: 8px 12px; border-radius: 10px; white-space: pre-line; font-size: .85rem; line-height: 1.5;
  background: var(--paper); color: var(--ink); border: 1px solid var(--glass-line);
  box-shadow: 0 18px 40px -20px var(--glass-shadow);
}
.tip[hidden] { display: none; }
`;
