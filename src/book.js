import crypto from 'node:crypto';
import { CHAPTER_PROMPT_VERSION, writeChapter } from './brain.js';
import { config } from './config.js';
import * as kb from './knowledge.js';

/**
 * สร้างหนังสือเป็นหน้าเว็บ HTML จากความรู้ทั้งหมดในฐานข้อมูล
 *
 * เนื้อหาหลักของแต่ละบทให้ AI เรียบเรียงเป็นภาษาคน แล้วเก็บไว้ในตาราง chapters
 * จะเขียนใหม่ก็ต่อเมื่อกฎในบทนั้นเปลี่ยน การเปิดหนังสือครั้งถัดไปจึงเร็วและไม่เสียเงินซ้ำ
 */

const CHAPTER_CONCURRENCY = 3;

export async function renderBook() {
  const data = await kb.loadBook();
  const active = data.rules.filter((r) => r.status === 'active');

  const byTopic = new Map();
  for (const rule of active) {
    if (!byTopic.has(rule.topic)) byTopic.set(rule.topic, []);
    byTopic.get(rule.topic).push(rule);
  }
  const topics = [...byTopic.keys()].sort((a, b) => a.localeCompare(b, 'th'));

  const contents = await mapLimit(topics, CHAPTER_CONCURRENCY, (topic) =>
    chapterContent(topic, byTopic.get(topic), data.chapters.get(topic)),
  );
  const chapters = topics.map((topic, i) => ({
    topic,
    rules: byTopic.get(topic),
    content: contents[i],
  }));

  return page(data, chapters);
}

async function chapterContent(topic, rules, cached) {
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify([CHAPTER_PROMPT_VERSION, rules.map((r) => [r.id, r.title, r.summary])]))
    .digest('hex');
  if (cached?.source_hash === hash) return cached.content;

  try {
    const content = await writeChapter(topic, rules);
    await kb.saveChapter(topic, hash, content);
    return content;
  } catch (err) {
    // เขียนบทไม่สำเร็จก็ยังแสดงรายการกฎได้ ไม่ต้องให้ทั้งหน้าพัง
    console.error(`[book] เรียบเรียงบท "${topic}" ไม่สำเร็จ:`, err.message);
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- ประวัติของกฎ ----------

/** ย้อนดูว่ากฎข้อนี้มาแทนกฎข้อไหน และข้อนั้นมาแทนข้อไหนอีก ไปจนถึงต้นทาง */
function lineage(ruleId, data) {
  const steps = [];
  const seen = new Set([ruleId]);
  const queue = [ruleId];
  while (queue.length > 0) {
    const id = queue.shift();
    for (const change of data.changes) {
      if (!change.new_rule_ids.includes(id)) continue;
      const olds = change.old_rule_ids.filter((old) => !seen.has(old));
      if (olds.length === 0) continue;
      steps.push({ change, oldRules: olds.map((old) => data.rulesById.get(old)).filter(Boolean) });
      olds.forEach((old) => seen.add(old));
      queue.push(...olds);
    }
  }
  return { steps, ids: [...seen] };
}

function sourcesFor(ids, data) {
  const byMessage = new Map();
  for (const source of data.sources) {
    if (ids.includes(source.rule_id)) byMessage.set(source.message_id, source);
  }
  return [...byMessage.values()].sort((a, b) => a.message_id - b.message_id);
}

// ---------- HTML ----------

const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const date = (value) =>
  new Date(value).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** ทำให้ (ข้อ #12) ในเนื้อหากดไปดูกฎข้อนั้นได้ */
// (?<!&) กันไม่ให้ไปแตะ &#39; ที่ได้จากการ escape เครื่องหมาย '
const linkRules = (html) =>
  html.replace(/(?<!&)#(\d+)/g, (_m, id) => `<a class="ref" href="#rule-${id}">#${id}</a>`);

const BULLET = /^(?:[-•]|\d+[.)])\s+/;

/**
 * แปลงข้อความที่ AI เขียนเป็น HTML
 * ย่อหน้าคั่นด้วยบรรทัดว่าง บรรทัดที่ขึ้นต้นด้วย "- " หรือ "1. " ติดกันรวมเป็นรายการเดียว
 */
function prose(text) {
  const html = [];
  for (const block of String(text ?? '').split(/\n\s*\n/)) {
    let paragraph = [];
    let items = [];
    const flush = () => {
      if (paragraph.length) html.push(`<p>${linkRules(escape(paragraph.join(' ')))}</p>`);
      if (items.length) html.push(`<ul>${items.map((i) => `<li>${linkRules(escape(i))}</li>`).join('')}</ul>`);
      paragraph = [];
      items = [];
    };
    for (const line of block.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (BULLET.test(line)) {
        if (paragraph.length) flush();
        items.push(line.replace(BULLET, ''));
      } else {
        if (items.length) flush();
        paragraph.push(line);
      }
    }
    flush();
  }
  return html.join('');
}

/**
 * ลิงก์ไฟล์เสียงมีลายเซ็นกำกับ คนที่เปิดหนังสือได้ถึงจะฟังได้
 * ใครเดาเลขข้อความแล้วลองเปิด /audio/123 เองจะเปิดไม่ได้
 */
export function audioSignature(messageId) {
  return crypto
    .createHmac('sha256', config.line.channelSecret)
    .update(`audio:${messageId}`)
    .digest('base64url')
    .slice(0, 22);
}

function voicePlayer(messageId) {
  const src = `/audio/${messageId}?sig=${audioSignature(messageId)}`;
  return `<audio controls preload="none" src="${src}"></audio>`;
}

/** ข้อความต้นฉบับ ถ้ามาจากเสียงจะมีปุ่มฟังเสียงจริงอยู่ด้วย */
function original({ text, source, messageId }) {
  const voice = source === 'voice';
  return `${voice ? `<p class="label">🎤 พูดมาเป็นเสียง · ข้อความด้านล่างถอดโดย AI</p>${voicePlayer(messageId)}` : ''}
    <p>${escape(text).replace(/\n/g, '<br>') || '<em>(ถอดเสียงไม่ออก)</em>'}</p>`;
}

function quote(source) {
  return `<blockquote>
    ${original({ text: source.text, source: source.source, messageId: source.message_id })}
    <cite>${escape(source.author)} · ${date(source.created_at)}</cite>
  </blockquote>`;
}

function ruleCard(rule, data) {
  const { steps, ids } = lineage(rule.id, data);
  const sources = sourcesFor(ids, data);
  const retired = rule.status === 'retired';

  const history = steps.length
    ? `<details>
        <summary>ประวัติการเปลี่ยนแปลง (${steps.length})</summary>
        ${steps
          .map(
            ({ change, oldRules }) => `<div class="change">
              <p class="meta">${date(change.created_at)} · ${escape(change.author)} ·
                ${change.kind === 'conflict' ? 'ตัดสินข้อขัดแย้ง' : 'เพิ่มรายละเอียด'}</p>
              <p>${linkRules(escape(change.reason))}</p>
              ${oldRules
                .map(
                  (old) => `<p class="old"><a class="ref" href="#rule-${old.id}">#${old.id}</a>
                    ฉบับเดิม: ${escape(old.summary)}</p>`,
                )
                .join('')}
            </div>`,
          )
          .join('')}
      </details>`
    : '';

  return `<article class="rule${retired ? ' retired' : ''}" id="rule-${rule.id}">
    <header>
      <span class="num">#${rule.id}</span>
      <h4>${escape(rule.title)}</h4>
      ${retired ? `<span class="badge">เลิกใช้ ${date(rule.retired_at)}</span>` : ''}
    </header>
    <p class="summary">${escape(rule.summary)}</p>
    <p class="meta">สอนโดย ${escape(rule.author)} · ${date(rule.created_at)}</p>
    ${
      sources.length
        ? `<details>
            <summary>คำพูดต้นฉบับจากผู้สอน (${sources.length})</summary>
            ${sources.map(quote).join('')}
          </details>`
        : ''
    }
    ${history}
  </article>`;
}

/**
 * ช่องโหว่ของบทนี้ มาจากคำถามที่บอทถามผู้สอนใน LINE ไปแล้วและยังไม่ได้คำตอบ
 * ไม่ได้ให้ AI คิดขึ้นตอนเขียนหนังสือ เพราะที่เขียนไว้ในเล่มต้องเป็นเรื่องที่มีคนถูกถามจริง
 */
function gapsAside(questions) {
  if (questions.length === 0) return '';

  const items = questions.map((q) => {
    const refs = (q.rule_ids ?? []).map((id) => `#${id}`).join(' ');
    const tail = refs && !q.question.includes('#') ? ` (ข้อ ${refs})` : '';
    const asked = q.asked_at ? ` — ถาม ${escape(q.author)} เมื่อ ${date(q.asked_at)}` : '';
    return `<li>${linkRules(escape(q.question) + tail)}<span class="meta">${asked}</span></li>`;
  });

  return `<aside class="gaps">
    <h3>สิ่งที่ยังไม่ชัด หรือยังไม่มีใครสอน</h3>
    <p class="meta">บอทถามผู้สอนใน LINE ไปแล้ว ยังรอคำตอบอยู่ ตอบในแชทเมื่อไหร่ บทนี้จะอัปเดตตาม</p>
    <ul>${items.join('')}</ul>
  </aside>`;
}

function chapterSection(chapter, index, data) {
  const { content } = chapter;
  const body = content
    ? `${content.overview ? `<div class="overview">${prose(content.overview)}</div>` : ''}
       ${content.sections
         .map((s) => `${s.heading ? `<h3>${escape(s.heading)}</h3>` : ''}${prose(s.body)}`)
         .join('')}`
    : `<p class="note">ยังเรียบเรียงบทนี้ไม่สำเร็จ ลองเปิดหน้านี้ใหม่อีกครั้ง ระหว่างนี้อ่านจากรายการกฎด้านล่างได้</p>`;

  return `<section class="chapter" id="ch-${index + 1}">
    <p class="eyebrow">บทที่ ${index + 1}</p>
    <h2>${escape(chapter.topic)}</h2>
    ${body}
    ${gapsAside(data.questions.filter((q) => q.topic === chapter.topic))}
    <h3 class="rules-heading">กฎในบทนี้ (${chapter.rules.length} ข้อ)</h3>
    ${chapter.rules.map((r) => ruleCard(r, data)).join('')}
  </section>`;
}

function conflictEntry(conflict) {
  const proposed = conflict.proposed ?? {};
  const proposedLines = [...(proposed.rules ?? []), ...(proposed.updates ?? [])];
  const outcome =
    conflict.status === 'open'
      ? '<span class="badge warn">รอคำตอบ</span>'
      : conflict.status === 'cancelled'
        ? '<span class="badge">ยกเลิก</span>'
        : '<span class="badge ok">ตัดสินแล้ว</span>';

  return `<article class="conflict">
    <header>${outcome}<span class="meta">${date(conflict.created_at)} · ${escape(conflict.author)}</span></header>
    <p><strong>ขัดกันตรงไหน:</strong> ${linkRules(escape(conflict.explanation))}</p>
    <p class="label">สิ่งที่ผู้สอนพูดมา</p>
    <blockquote>${original({
      text: conflict.original_text,
      source: conflict.original_source,
      messageId: conflict.message_id,
    })}</blockquote>
    ${
      proposedLines.length
        ? `<p class="label">AI สรุปไว้ว่า</p>
           <ul>${proposedLines.map((r) => `<li>${escape(r.summary)}</li>`).join('')}</ul>`
        : ''
    }
    <p class="label">บอทถามกลับ</p>
    <p>${linkRules(escape(conflict.question))}</p>
    ${
      conflict.answer_text
        ? `<p class="label">ผู้สอนตอบ</p>
           <blockquote>${original({
             text: conflict.answer_text,
             source: conflict.answer_source,
             messageId: conflict.answer_message_id,
           })}</blockquote>`
        : ''
    }
    ${conflict.decision ? `<p><strong>ข้อสรุป:</strong> ${linkRules(escape(conflict.decision))}</p>` : ''}
  </article>`;
}

function page(data, chapters) {
  data.rulesById = new Map(data.rules.map((r) => [r.id, r]));
  const retired = data.rules.filter((r) => r.status === 'retired');
  const activeCount = data.rules.length - retired.length;
  const teachers = new Set(data.rules.map((r) => r.author)).size;
  const conflicts = [...data.conflicts].reverse();
  const openConflicts = conflicts.filter((c) => c.status === 'open');
  const closedConflicts = conflicts.filter((c) => c.status !== 'open');

  const toc = [
    ...chapters.map(
      (c, i) => `<li><a href="#ch-${i + 1}">บทที่ ${i + 1} · ${escape(c.topic)}</a>
        <span>${c.rules.length} ข้อ</span></li>`,
    ),
    openConflicts.length ? `<li><a href="#open">เรื่องที่รอคำตอบ</a><span>${openConflicts.length}</span></li>` : '',
    closedConflicts.length
      ? `<li><a href="#decisions">ภาคผนวก ก · ข้อขัดแย้งที่เคยตัดสิน</a><span>${closedConflicts.length}</span></li>`
      : '',
    retired.length
      ? `<li><a href="#retired">ภาคผนวก ข · กฎที่เลิกใช้แล้ว</a><span>${retired.length}</span></li>`
      : '',
  ].join('');

  const main =
    chapters.length === 0
      ? `<p class="note">ยังไม่มีความรู้ในเล่ม เริ่มเล่ากฎหรือวิธีทำงานให้บอทฟังผ่าน LINE ได้เลย</p>`
      : chapters.map((c, i) => chapterSection(c, i, data)).join('');

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(config.book.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<main>
  <header class="cover">
    <p class="eyebrow">ความรู้ที่ทีมสอนผ่าน LINE</p>
    <h1>${escape(config.book.title)}</h1>
    <p class="stats">
      <span><strong>${activeCount}</strong> กฎที่ใช้อยู่</span>
      <span><strong>${chapters.length}</strong> บท</span>
      <span><strong>${teachers}</strong> ผู้สอน</span>
    </p>
    <p class="meta">อัปเดตล่าสุด ${date(new Date())}</p>
  </header>

  <aside class="howto">
    <h2>วิธีอ่านเล่มนี้</h2>
    <ul>
      <li>แต่ละบทเริ่มด้วยคำอธิบายที่ AI เรียบเรียงจากกฎทั้งหมดในบทนั้น ให้อ่านเข้าใจภาพรวมก่อน</li>
      <li>ท้ายบทคือรายการกฎทีละข้อ ตัวเลข <a class="ref" href="#">#12</a> กดเพื่อไปดูข้อนั้นได้</li>
      <li>กด "คำพูดต้นฉบับ" เพื่ออ่านสิ่งที่ผู้สอนพิมพ์มาจริง ๆ ถ้าคำสรุปของ AI กับต้นฉบับไม่ตรงกัน ให้ถือต้นฉบับเป็นหลัก</li>
      <li>กล่องสีเหลืองท้ายบทคือช่องโหว่ที่บอทถามผู้สอนใน LINE ไปแล้วและยังไม่ได้คำตอบ ใครรู้คำตอบช่วยตอบในแชทได้เลย</li>
      <li>เรื่องที่เคยขัดแย้งกันและเหตุผลที่ตัดสิน อยู่ในภาคผนวกท้ายเล่ม</li>
    </ul>
  </aside>

  ${chapters.length || toc ? `<nav class="toc"><h2>สารบัญ</h2><ol>${toc}</ol></nav>` : ''}

  ${main}

  ${
    openConflicts.length
      ? `<section class="chapter" id="open">
          <p class="eyebrow">ยังไม่ได้ข้อสรุป</p>
          <h2>เรื่องที่รอคำตอบ</h2>
          <p>เรื่องเหล่านี้มีคนสอนมาแต่ขัดกับของเดิม บอทถามกลับไปแล้วและยังรอคำตอบ จึงยังไม่ได้บันทึกเป็นกฎ</p>
          ${openConflicts.map(conflictEntry).join('')}
        </section>`
      : ''
  }

  ${
    closedConflicts.length
      ? `<section class="chapter" id="decisions">
          <p class="eyebrow">ภาคผนวก ก</p>
          <h2>ข้อขัดแย้งที่เคยตัดสิน</h2>
          <p>บันทึกว่าเคยมีความเห็นไม่ตรงกันเรื่องอะไร ใครตอบว่าอย่างไร และสรุปออกมาแบบไหน</p>
          ${closedConflicts.map(conflictEntry).join('')}
        </section>`
      : ''
  }

  ${
    retired.length
      ? `<section class="chapter" id="retired">
          <p class="eyebrow">ภาคผนวก ข</p>
          <h2>กฎที่เลิกใช้แล้ว</h2>
          <p>เก็บไว้ให้รู้ว่าเคยทำแบบนี้ ห้ามนำไปใช้ ให้ดูกฎฉบับปัจจุบันในบทต่าง ๆ แทน</p>
          ${[...retired].reverse().map((r) => ruleCard(r, data)).join('')}
        </section>`
      : ''
  }
</main>
<script>
  // สั่งพิมพ์ / บันทึกเป็น PDF แล้วให้เนื้อหาที่พับไว้ออกมาครบ
  addEventListener('beforeprint', () => document.querySelectorAll('details').forEach((d) => (d.open = true)));
</script>
</body>
</html>`;
}

const STYLE = `
:root {
  --bg: #f7f4ee; --paper: #fffdf9; --ink: #1f1d1a; --muted: #6b655c; --line: #e4ddd1;
  --accent: #8a4b16; --accent-soft: #f4e6d6; --warn: #9a5b00; --warn-soft: #fbecd2;
  --ok: #2f6b3f; --ok-soft: #e1f0e4; --quote: #f3efe7;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #171513; --paper: #1f1c19; --ink: #ece6dc; --muted: #a39b8f; --line: #3a352f;
    --accent: #e0a36b; --accent-soft: #3b2a1b; --warn: #f0b660; --warn-soft: #3a2c14;
    --ok: #8fcf9e; --ok-soft: #1e3324; --quote: #26221e;
  }
}
:root[data-theme="dark"] {
  --bg: #171513; --paper: #1f1c19; --ink: #ece6dc; --muted: #a39b8f; --line: #3a352f;
  --accent: #e0a36b; --accent-soft: #3b2a1b; --warn: #f0b660; --warn-soft: #3a2c14;
  --ok: #8fcf9e; --ok-soft: #1e3324; --quote: #26221e;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 17px/1.75 'Sarabun', system-ui, sans-serif;
}
main { max-width: 760px; margin: 0 auto; padding: 48px 16px 96px; }
h1, h2, h3, h4 { line-height: 1.35; margin: 0; }
h1 { font-size: 2.2rem; }
h2 { font-size: 1.6rem; margin-bottom: 16px; }
h3 { font-size: 1.15rem; margin: 28px 0 8px; }
h4 { font-size: 1.05rem; }
p { margin: 0 0 14px; }
a { color: var(--accent); }
.eyebrow { color: var(--accent); font-weight: 600; font-size: .85rem; letter-spacing: .04em; margin-bottom: 4px; }
.meta { color: var(--muted); font-size: .88rem; }
.note { color: var(--muted); font-style: italic; }
.cover { padding: 24px 0 32px; border-bottom: 1px solid var(--line); margin-bottom: 32px; }
.stats { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 16px 0 4px; color: var(--muted); }
.stats strong { color: var(--ink); font-size: 1.3rem; margin-right: 4px; }
.howto, .toc, .gaps {
  background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
  padding: 20px 24px; margin-bottom: 24px;
}
.howto h2, .toc h2 { font-size: 1.1rem; margin-bottom: 8px; }
.howto ul { margin: 0; padding-left: 20px; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-bottom: 1px dashed var(--line); }
.toc li:last-child { border-bottom: 0; }
.toc span { color: var(--muted); white-space: nowrap; }
.chapter { padding-top: 40px; margin-top: 40px; border-top: 1px solid var(--line); }
.overview { font-size: 1.08rem; }
.gaps { background: var(--warn-soft); border-color: transparent; margin-top: 24px; }
.gaps h3 { margin-top: 0; color: var(--warn); }
.gaps ul { margin: 0; padding-left: 20px; }
.gaps li { margin-bottom: 6px; }
.gaps .meta { font-size: .82rem; }
.rules-heading { color: var(--muted); font-size: 1rem; margin-top: 36px; }
.rule, .conflict {
  background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
  padding: 16px 20px; margin: 12px 0; scroll-margin-top: 16px;
}
.rule:target { outline: 2px solid var(--accent); }
.rule header, .conflict header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.num { color: var(--accent); font-weight: 700; }
.summary { margin-bottom: 6px; }
.retired { opacity: .75; }
.badge { font-size: .78rem; padding: 1px 8px; border-radius: 999px; background: var(--line); color: var(--muted); }
.badge.warn { background: var(--warn-soft); color: var(--warn); }
.badge.ok { background: var(--ok-soft); color: var(--ok); }
.ref { text-decoration: none; font-weight: 600; background: var(--accent-soft); padding: 0 5px; border-radius: 4px; }
details { margin-top: 8px; }
summary { cursor: pointer; color: var(--accent); font-size: .92rem; }
blockquote { margin: 8px 0; padding: 10px 14px; background: var(--quote); border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; }
blockquote p { margin: 0 0 4px; }
cite { color: var(--muted); font-size: .85rem; font-style: normal; }
.change { border-top: 1px dashed var(--line); padding-top: 8px; margin-top: 8px; }
.old { color: var(--muted); font-size: .92rem; }
.label { color: var(--muted); font-size: .85rem; font-weight: 600; margin: 12px 0 2px; }
blockquote .label { margin-top: 0; }
audio { display: block; width: 100%; max-width: 360px; height: 36px; margin: 4px 0 8px; }
@media print {
  body { background: #fff; font-size: 12pt; }
  .rule, .conflict, .howto, .toc { break-inside: avoid; }
  .chapter { break-before: page; }
}
`;
