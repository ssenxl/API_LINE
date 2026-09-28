import crypto from 'node:crypto';
import express from 'express';
import {
  bookPage,
  chatPage,
  conflictsPage,
  historyPage,
  overviewPage,
  questionsPage,
  rulesPage,
  trashPage,
  usersPage,
} from './admin-views.js';
import { sendAudio } from './audio.js';
import { BOOK_SECTIONS, bookSettings } from './book.js';
import { config } from './config.js';
import * as kb from './knowledge.js';

/**
 * หน้าผู้ดูแล /admin ดูทุกอย่างในระบบ และจัดการได้ทุกอย่างจากที่นี่
 * - แก้ เลิกใช้ กู้คืนกฎ
 * - ซ่อนหรือแสดงกฎ คำถาม บท และส่วนต่าง ๆ ในหนังสือ
 * - ลบกฎ คำถาม ข้อขัดแย้ง ข้อความแชท (เข้าถังขยะก่อน ลบถาวรจากถังขยะอีกที)
 * - ดูแชททุกคน ฟังเสียงต้นฉบับ ดูพื้นที่ฐานข้อมูล และประวัติการเปลี่ยนทั้งหมด
 *
 * ไม่ทำผ่าน LINE เพราะการเลิกใช้หรือลบควรเป็นคนที่ตั้งใจเข้ามาจัดการเอง ไม่ใช่ให้ AI ตีความจากแชท
 * ทุกอย่างที่ทำจากหน้านี้จดลง admin_log ย้อนดูได้ที่หน้าประวัติ
 */

const NO_REASON = 'ไม่ได้ระบุเหตุผล';
const CHAT_PAGE = 200;
const HISTORY_PAGE = 200;

function safeEqual(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * ใช้ Basic Auth ของเบราว์เซอร์ ไม่ต้องทำหน้า login เอง
 * ช่องชื่อผู้ใช้ใส่อะไรก็ได้ ช่องรหัสผ่านคือ ADMIN_KEY
 */
function requireKey(req, res, next) {
  const [scheme, encoded] = (req.get('authorization') ?? '').split(' ');
  const decoded = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString() : '';
  const password = decoded.slice(decoded.indexOf(':') + 1);
  if (decoded && safeEqual(password, config.admin.key)) return next();

  res
    .status(401)
    .set('WWW-Authenticate', 'Basic realm="admin", charset="UTF-8"')
    .type('text/plain; charset=utf-8')
    .send('ต้องใส่รหัสผู้ดูแล (ADMIN_KEY) ในช่องรหัสผ่าน');
}

/**
 * เบราว์เซอร์แนบรหัส Basic Auth ไปให้เองทุกครั้ง แม้ฟอร์มจะถูกส่งมาจากเว็บอื่น
 * จึงต้องเช็กว่าส่งมาจากหน้านี้จริง กันเว็บอื่นแอบสั่งลบของในนามเรา
 */
function sameOrigin(req, res, next) {
  try {
    const host = new URL(req.get('origin')).host;
    if (host === req.get('host') || host === new URL(config.publicUrl).host) return next();
  } catch {
    // ไม่มี Origin หรืออ่านไม่ออก ถือว่าไม่ผ่าน
  }
  res.status(403).type('text/plain; charset=utf-8').send('ต้องกดจากหน้าผู้ดูแลเท่านั้น');
}

/** ฟอร์มส่ง \r\n มาเป็นตัวขึ้นบรรทัด แปลงให้ตรงกับที่บอทเก็บ จะได้เทียบได้ว่าแก้อะไรไปจริงไหม */
const field = (body, name, max) =>
  String(body?.[name] ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

const reasonOf = (body) => field(body, 'reason', 500) || NO_REASON;

/** ทำเสร็จแล้วเด้งกลับหน้าที่กดมา (POST → redirect → GET) กด refresh จะได้ไม่ส่งฟอร์มซ้ำ */
function back(res, { path, anchor, ...params }) {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
  );
  res.redirect(303, `${path}?${search}${anchor ? `#${anchor}` : ''}`);
}

// ค่าใน URL ที่เป็นของข้อความแจ้งผลรอบก่อน ไม่ต้องพาไปด้วยตอนเด้งกลับ
const NOTICE_PARAMS = new Set(['done', 'id', 'to', 'n', 'what']);

/**
 * เด้งกลับหน้าที่ส่งฟอร์มมา (จาก Referer) พร้อมตัวกรองเดิม เช่น ?status= หรือหน้าแชทเดิม
 * ถ้าไม่ใช่หน้าในระบบผู้ดูแล กลับหน้าที่กำหนดไว้แทน
 */
function returnPath(req, fallback) {
  try {
    const url = new URL(req.get('referer'));
    if (url.host === req.get('host') && url.pathname.startsWith('/admin')) {
      const keep = [...url.searchParams].filter(([key]) => !NOTICE_PARAMS.has(key));
      return { path: url.pathname, ...Object.fromEntries(keep) };
    }
  } catch {
    // ไม่มี Referer ก็กลับหน้าที่กำหนดไว้
  }
  return { path: fallback };
}

/**
 * ครอบคำสั่งที่ทำกับของชิ้นเดียว (มี :id ใน path)
 * fn คืน { done, ... } แล้วจะเด้งกลับหน้าที่กดมาพร้อมข้อความแจ้ง
 */
function action(name, fallback, fn) {
  return [
    sameOrigin,
    async (req, res) => {
      const from = returnPath(req, fallback);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return back(res, { ...from, done: 'missing' });
      try {
        back(res, { ...from, ...(await fn(id, req.body ?? {})) });
      } catch (err) {
        console.error(`[admin] ${name} ${id} ไม่สำเร็จ:`, err);
        back(res, { ...from, done: 'error' });
      }
    },
  ];
}

/** หน้าที่อ่านอย่างเดียว ถ้าพังให้ขึ้นข้อความแทนหน้าว่าง */
function view(name, fn) {
  return async (req, res) => {
    try {
      res.type('html').send(await fn(req));
    } catch (err) {
      console.error(`[admin] เปิดหน้า${name}ไม่สำเร็จ:`, err);
      res.status(500).type('text/plain; charset=utf-8').send(`เปิดหน้า${name}ไม่สำเร็จ ลองใหม่อีกครั้ง`);
    }
  };
}

const short = (value, max = 80) => (value.length > max ? `${value.slice(0, max)}…` : value);

export const adminRouter = express.Router();
adminRouter.use(requireKey);
adminRouter.use(express.urlencoded({ extended: false }));

// ---------- หน้าต่าง ๆ ----------

adminRouter.get(
  '/',
  view('ภาพรวม', async (req) => {
    const [overview, timeline] = await Promise.all([kb.loadOverview(), kb.loadTimeline(10)]);
    return overviewPage({ overview, timeline, query: req.query });
  }),
);

adminRouter.get(
  '/rules',
  view('กฎ', async (req) => rulesPage({ ...(await kb.loadRulesAdmin()), query: req.query })),
);

adminRouter.get(
  '/questions',
  view('คำถาม', async (req) => {
    const status = ['open', 'answered', 'skipped', 'all'].includes(req.query.status) ? req.query.status : 'open';
    const questions = await kb.loadQuestionsAdmin(status === 'all' ? null : status);
    return questionsPage({ questions, status, query: req.query });
  }),
);

adminRouter.get(
  '/conflicts',
  view('ข้อขัดแย้ง', async (req) => conflictsPage({ conflicts: await kb.loadConflictsAdmin(), query: req.query })),
);

adminRouter.get(
  '/chats',
  view('แชท', async (req) =>
    usersPage({ users: await kb.listUsersAdmin(), teachers: config.teachers, query: req.query }),
  ),
);

adminRouter.get(
  '/chats/:userId',
  view('แชท', async (req) => {
    const before = Number(req.query.before);
    const { user, messages } = await kb.loadChat(
      req.params.userId,
      Number.isInteger(before) && before > 0 ? before : null,
      CHAT_PAGE + 1,
    );
    // ดึงเกินมาหนึ่งข้อความไว้รู้ว่ายังมีข้อความเก่ากว่านี้อีกไหม
    const hasMore = messages.length > CHAT_PAGE;
    return chatPage({
      user,
      userId: req.params.userId,
      messages: hasMore ? messages.slice(1) : messages,
      hasMore,
      teachers: config.teachers,
      query: req.query,
    });
  }),
);

adminRouter.get(
  '/history',
  view('ประวัติ', async (req) => {
    const asked = Number(req.query.limit);
    const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 5000) : HISTORY_PAGE;
    return historyPage({ timeline: await kb.loadTimeline(limit), limit, query: req.query });
  }),
);

adminRouter.get(
  '/book',
  view('หนังสือ', async (req) => {
    const [saved, { rules }, questions] = await Promise.all([
      kb.getSetting('book'),
      kb.loadRulesAdmin(),
      kb.loadQuestionsAdmin(null),
    ]);
    const counts = new Map();
    for (const rule of rules.filter((r) => r.status === 'active')) {
      counts.set(rule.topic, (counts.get(rule.topic) ?? 0) + 1);
    }
    const topics = [...counts]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => a.topic.localeCompare(b.topic, 'th'));
    return bookPage({
      settings: bookSettings(saved),
      topics,
      hiddenRules: rules.filter((r) => r.hidden).length,
      hiddenQuestions: questions.filter((q) => q.hidden).length,
      query: req.query,
    });
  }),
);

adminRouter.get(
  '/trash',
  view('ถังขยะ', async (req) => trashPage({ items: await kb.listTrash(), query: req.query })),
);

// ผู้ดูแลฟังเสียงได้ทุกข้อความ ไม่ขึ้นกับว่าหนังสือเปิดปุ่มฟังเสียงไว้หรือไม่
adminRouter.get('/audio/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).end();
  sendAudio(req, res, id);
});

// ---------- กฎ ----------

adminRouter.post(
  '/rules/:id/edit',
  action('แก้กฎ', '/admin/rules', async (id, body) => {
    const rule = {
      topic: field(body, 'topic', 100) || 'เรื่องทั่วไป',
      title: field(body, 'title', 200),
      summary: field(body, 'summary', 4000),
    };
    if (!rule.title || !rule.summary) return { done: 'invalid', id, anchor: `rule-${id}` };

    const reason = reasonOf(body);
    const newId = await kb.editRule({ ruleId: id, rule, reason });
    if (newId === null) return { done: 'missing', id };
    if (newId === id) return { done: 'unchanged', id, anchor: `rule-${id}` };
    await kb.logAdmin('แก้กฎ', `#${id} → #${newId}: ${reason}`);
    return { done: 'edited', id, to: newId, anchor: `rule-${newId}` };
  }),
);

adminRouter.post(
  '/rules/:id/retire',
  action('เลิกใช้กฎ', '/admin/rules', async (id, body) => {
    const reason = reasonOf(body);
    if (!(await kb.retireRule({ ruleId: id, reason }))) return { done: 'missing', id };
    await kb.logAdmin('เลิกใช้กฎ', `#${id}: ${reason}`);
    return { done: 'retired', id };
  }),
);

adminRouter.post(
  '/rules/:id/restore',
  action('กู้คืนกฎ', '/admin/rules', async (id, body) => {
    const reason = reasonOf(body);
    if (!(await kb.restoreRule({ ruleId: id, reason }))) return { done: 'missing', id };
    await kb.logAdmin('กู้คืนกฎ', `#${id}: ${reason}`);
    return { done: 'restored', id, anchor: `rule-${id}` };
  }),
);

for (const hidden of [true, false]) {
  adminRouter.post(
    `/rules/:id/${hidden ? 'hide' : 'show'}`,
    action('ซ่อน/แสดงกฎ', '/admin/rules', async (id) => {
      const rule = await kb.setRuleHidden(id, hidden);
      if (!rule) return { done: 'missing', id };
      await kb.logAdmin(hidden ? 'ซ่อนกฎจากหนังสือ' : 'แสดงกฎในหนังสือ', `#${id} ${rule.title}`);
      return { done: hidden ? 'hidden' : 'shown', what: 'rule', id, anchor: `rule-${id}` };
    }),
  );

  adminRouter.post(
    `/questions/:id/${hidden ? 'hide' : 'show'}`,
    action('ซ่อน/แสดงคำถาม', '/admin/questions', async (id) => {
      const question = await kb.setQuestionHidden(id, hidden);
      if (!question) return { done: 'missing' };
      await kb.logAdmin(hidden ? 'ซ่อนคำถามจากหนังสือ' : 'แสดงคำถามในหนังสือ', short(question.question));
      return { done: hidden ? 'hidden' : 'shown', what: 'question' };
    }),
  );
}

adminRouter.post(
  '/rules/:id/trash',
  action('ลบกฎ', '/admin/rules', async (id) => {
    const rule = await kb.trashRule(id);
    if (!rule) return { done: 'missing', id };
    await kb.logAdmin('ลบกฎ', `#${id} ${rule.title}`);
    return { done: 'trashed', what: 'rule', id };
  }),
);

// ---------- คำถาม ----------

adminRouter.post(
  '/questions/:id/close',
  action('ปิดคำถาม', '/admin/questions', async (id) => {
    const closed = await kb.closeQuestions({ ids: [id], status: 'skipped' });
    if (!closed) return { done: 'missing' };
    await kb.logAdmin('ปิดคำถาม', `คำถามที่ ${id}`);
    return { done: 'closed' };
  }),
);

adminRouter.post(
  '/questions/:id/trash',
  action('ลบคำถาม', '/admin/questions', async (id) => {
    const question = await kb.trashQuestion(id);
    if (!question) return { done: 'missing' };
    await kb.logAdmin('ลบคำถาม', short(question.question));
    return { done: 'trashed', what: 'question' };
  }),
);

// ---------- ข้อขัดแย้ง ----------

adminRouter.post(
  '/conflicts/:id/cancel',
  action('ยกเลิกข้อขัดแย้ง', '/admin/conflicts', async (id) => {
    const cancelled = await kb.cancelConflict({
      conflictId: id,
      answerMessageId: null,
      decision: 'ผู้ดูแลยกเลิกจากหน้าจัดการ ไม่บันทึกเรื่องนี้',
    });
    if (!cancelled) return { done: 'missing' };
    await kb.logAdmin('ยกเลิกข้อขัดแย้ง', `เรื่องที่ ${id}`);
    return { done: 'cancelled' };
  }),
);

adminRouter.post(
  '/conflicts/:id/trash',
  action('ลบข้อขัดแย้ง', '/admin/conflicts', async (id) => {
    const conflict = await kb.trashConflict(id);
    if (!conflict) return { done: 'missing' };
    await kb.logAdmin('ลบข้อขัดแย้ง', `เรื่องที่ ${id}: ${short(conflict.explanation)}`);
    return { done: 'trashed', what: 'conflict', id };
  }),
);

// ---------- ข้อความแชท ----------

adminRouter.post(
  '/messages/:id/trash',
  action('ลบข้อความ', '/admin/chats', async (id) => {
    const result = await kb.trashMessage(id);
    if (!result) return { done: 'missing' };
    if (result.blockedBy) return { done: 'blocked', id: result.blockedBy[0] };
    await kb.logAdmin('ลบข้อความแชท', short(result.message.text || '(เสียง)'));
    return { done: 'trashed', what: 'message' };
  }),
);

// ---------- หนังสือ ----------

adminRouter.post('/book/sections', sameOrigin, async (req, res) => {
  try {
    const current = bookSettings(await kb.getSetting('book'));
    const sections = Object.fromEntries(BOOK_SECTIONS.map(({ key }) => [key, req.body?.[key] === '1']));
    await kb.saveSetting('book', { ...current, sections });
    const off = BOOK_SECTIONS.filter(({ key }) => !sections[key]).map(({ label }) => label);
    await kb.logAdmin('ตั้งค่าหนังสือ', off.length ? `ซ่อน: ${off.join(', ')}` : 'แสดงทุกส่วน');
    back(res, { path: '/admin/book', done: 'saved' });
  } catch (err) {
    console.error('[admin] บันทึกค่าหนังสือไม่สำเร็จ:', err);
    back(res, { path: '/admin/book', done: 'error' });
  }
});

adminRouter.post('/book/topics', sameOrigin, async (req, res) => {
  const topic = field(req.body, 'topic', 100);
  const hide = req.body?.hidden === '1';
  if (!topic) return back(res, { path: '/admin/book', done: 'missing' });
  try {
    const current = bookSettings(await kb.getSetting('book'));
    const hiddenTopics = current.hiddenTopics.filter((t) => t !== topic);
    if (hide) hiddenTopics.push(topic);
    await kb.saveSetting('book', { ...current, hiddenTopics });
    await kb.logAdmin(hide ? 'ซ่อนบทจากหนังสือ' : 'แสดงบทในหนังสือ', topic);
    back(res, { path: '/admin/book', done: 'saved' });
  } catch (err) {
    console.error('[admin] ซ่อน/แสดงบทไม่สำเร็จ:', err);
    back(res, { path: '/admin/book', done: 'error' });
  }
});

// ---------- ถังขยะ ----------

adminRouter.post(
  '/trash/:id/restore',
  action('กู้คืนจากถังขยะ', '/admin/trash', async (id) => {
    const result = await kb.restoreFromTrash(id);
    if (!result) return { done: 'missing' };
    if (result.error) return { done: result.error };
    await kb.logAdmin('กู้คืนจากถังขยะ', short(result.item.label));
    return { done: 'untrashed' };
  }),
);

adminRouter.post(
  '/trash/:id/purge',
  action('ลบถาวร', '/admin/trash', async (id) => {
    const n = await kb.purgeTrash([id]);
    if (!n) return { done: 'missing' };
    await kb.logAdmin('ลบถาวร', `รายการที่ ${id} ในถังขยะ`);
    return { done: 'purged', n };
  }),
);

adminRouter.post('/trash/empty', sameOrigin, async (_req, res) => {
  try {
    const n = await kb.purgeTrash(null);
    await kb.logAdmin('ล้างถังขยะ', `ลบถาวร ${n} รายการ`);
    back(res, { path: '/admin/trash', done: 'purged', n });
  } catch (err) {
    console.error('[admin] ล้างถังขยะไม่สำเร็จ:', err);
    back(res, { path: '/admin/trash', done: 'error' });
  }
});
