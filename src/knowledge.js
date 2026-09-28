import { query, withTransaction } from './db.js';
import { config } from './config.js';

/**
 * ทุกอย่างที่อ่าน/เขียนคลังความรู้อยู่ในไฟล์นี้
 * ไฟล์อื่นไม่ควรเขียน SQL เอง
 */

const UNKNOWN_NAME = 'ไม่ทราบชื่อ';

// ---------- ผู้ใช้และบทสนทนา ----------

export async function getUser(userId) {
  const { rows } = await query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return rows[0] ?? null;
}

export async function saveUser(userId, displayName) {
  await query(
    `INSERT INTO users (user_id, display_name) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET display_name = COALESCE(EXCLUDED.display_name, users.display_name),
           updated_at = now()`,
    [userId, displayName],
  );
}

/** ให้ AI ลืมแชทก่อนหน้านี้ ข้อความเดิมยังอยู่ในฐานข้อมูลเป็นหลักฐาน */
export async function resetContext(userId) {
  await query(
    `INSERT INTO users (user_id, context_reset_at) VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE SET context_reset_at = now()`,
    [userId],
  );
}

export async function saveMessage(userId, role, text, source = 'text') {
  const { rows } = await query(
    'INSERT INTO messages (user_id, role, text, source) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, role, text, source],
  );
  return rows[0].id;
}

/** ข้อความเสียง: เก็บทั้งข้อความที่ถอดได้และไฟล์เสียงต้นฉบับพร้อมกัน */
export async function saveVoiceMessage(userId, transcript, { buffer, mime, durationMs }) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO messages (user_id, role, text, source) VALUES ($1, 'user', $2, 'voice')
       RETURNING id`,
      [userId, transcript],
    );
    await db.query(
      `INSERT INTO audio (message_id, mime, duration_ms, size_bytes, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, mime, durationMs ?? null, buffer.length, buffer],
    );
    return rows[0].id;
  });
}

export async function getAudio(messageId) {
  const { rows } = await query('SELECT mime, data FROM audio WHERE message_id = $1', [messageId]);
  return rows[0] ?? null;
}

export async function getMessage(id) {
  const { rows } = await query('SELECT * FROM messages WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/** แชทล่าสุดที่ยังไม่หมดอายุและอยู่หลังคำสั่ง "เริ่มใหม่" เรียงจากเก่าไปใหม่ */
export async function recentMessages(userId) {
  const { maxMessages, ttlMinutes } = config.conversation;
  const { rows } = await query(
    `SELECT role, text FROM messages
     WHERE user_id = $1
       AND created_at > now() - make_interval(mins => $2)
       AND created_at > COALESCE(
             (SELECT context_reset_at FROM users WHERE user_id = $1), '-infinity')
     ORDER BY id DESC
     LIMIT $3`,
    [userId, ttlMinutes, maxMessages],
  );
  return rows.reverse().map((m) => ({ role: m.role, content: m.text }));
}

// ---------- กฎ ----------

export async function listActiveRules() {
  const { rows } = await query(
    `SELECT r.id, r.topic, r.title, r.summary, r.created_at,
            COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
     FROM rules r LEFT JOIN users u ON u.user_id = r.created_by
     WHERE r.status = 'active'
     ORDER BY r.topic, r.id`,
  );
  return rows;
}

export async function getRules(ids) {
  if (ids.length === 0) return [];
  const { rows } = await query(
    `SELECT r.*, COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
     FROM rules r LEFT JOIN users u ON u.user_id = r.created_by
     WHERE r.id = ANY($1) ORDER BY r.id`,
    [ids],
  );
  return rows;
}

async function insertRule(db, rule, userId, messageIds) {
  const { rows } = await db.query(
    `INSERT INTO rules (topic, title, summary, created_by) VALUES ($1, $2, $3, $4)
     RETURNING id, topic, title, summary`,
    [rule.topic, rule.title, rule.summary, userId],
  );
  for (const messageId of messageIds) {
    await db.query(
      'INSERT INTO rule_sources (rule_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [rows[0].id, messageId],
    );
  }
  return rows[0];
}

/** เลิกใช้กฎ คืนเฉพาะ id ที่เลิกได้จริง (ข้ามตัวที่คนอื่นเปลี่ยนไปก่อนแล้ว) */
async function retireRules(db, ids) {
  if (ids.length === 0) return [];
  const { rows } = await db.query(
    `UPDATE rules SET status = 'retired', retired_at = now()
     WHERE id = ANY($1) AND status = 'active' RETURNING id`,
    [ids],
  );
  return rows.map((r) => r.id);
}

/**
 * บันทึกสิ่งที่ผู้ใช้สอนมา ในกรณีที่ไม่ขัดกับของเดิม
 * - rules: กฎใหม่
 * - updates: เพิ่มรายละเอียดให้กฎเดิม (เลิกใช้ฉบับเก่า สร้างฉบับใหม่ เก็บประวัติไว้)
 * - duplicateIds: พูดซ้ำกับกฎเดิม แค่แนบข้อความนี้เป็นหลักฐานเพิ่ม
 */
export async function saveTeaching({ userId, messageId, rules, updates, duplicateIds }) {
  return withTransaction(async (db) => {
    const saved = [];

    for (const ruleId of duplicateIds) {
      await db.query(
        'INSERT INTO rule_sources (rule_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [ruleId, messageId],
      );
    }

    for (const update of updates) {
      const retired = await retireRules(db, [update.rule_id]);
      if (retired.length === 0) continue;
      const rule = await insertRule(db, update, userId, [messageId]);
      await db.query(
        `INSERT INTO rule_changes (kind, old_rule_ids, new_rule_ids, reason, user_id)
         VALUES ('refine', $1, $2, $3, $4)`,
        [retired, [rule.id], update.reason || 'เพิ่มรายละเอียด', userId],
      );
      saved.push({ ...rule, kind: 'updated', replaces: update.rule_id });
    }

    for (const newRule of rules) {
      saved.push({ ...(await insertRule(db, newRule, userId, [messageId])), kind: 'new' });
    }

    return saved;
  });
}

// ---------- ข้อขัดแย้ง ----------

/** ข้อขัดแย้งที่ยังรอผู้ใช้คนนี้ตอบ ถ้ามีหลายเรื่องให้ตอบเรื่องเก่าสุดก่อน */
export async function getOpenConflict(userId) {
  const { rows } = await query(
    `SELECT * FROM conflicts WHERE user_id = $1 AND status = 'open' ORDER BY id LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function createConflict({ userId, messageId, proposed, ruleIds, explanation, question }) {
  const { rows } = await query(
    `INSERT INTO conflicts (user_id, message_id, proposed, rule_ids, explanation, question)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, messageId, JSON.stringify(proposed), ruleIds, explanation, question],
  );
  return rows[0].id;
}

/** คืนจำนวนที่ยกเลิกได้จริง เป็น 0 ถ้าเรื่องนั้นถูกตัดสินหรือยกเลิกไปก่อนแล้ว */
export async function cancelConflict({ conflictId, answerMessageId, decision }) {
  const { rowCount } = await query(
    `UPDATE conflicts
     SET status = 'cancelled', decision = $2, answer_message_id = $3, resolved_at = now()
     WHERE id = $1 AND status = 'open'`,
    [conflictId, decision, answerMessageId],
  );
  return rowCount;
}

/**
 * บันทึกผลการตัดสินข้อขัดแย้ง กฎใหม่จะอ้างอิงทั้งข้อความที่สอนมาตอนแรก
 * และคำตอบที่ผู้ใช้ให้ตอนถูกถามกลับ
 */
export async function saveResolution({ conflict, userId, answerMessageId, retireIds, addRules, decision }) {
  return withTransaction(async (db) => {
    const retired = await retireRules(db, retireIds);
    const added = [];
    for (const rule of addRules) {
      added.push(await insertRule(db, rule, userId, [conflict.message_id, answerMessageId]));
    }

    await db.query(
      `INSERT INTO rule_changes (kind, old_rule_ids, new_rule_ids, reason, conflict_id, user_id)
       VALUES ('conflict', $1, $2, $3, $4, $5)`,
      [retired, added.map((r) => r.id), decision, conflict.id, userId],
    );
    await db.query(
      `UPDATE conflicts
       SET status = 'resolved', decision = $2, answer_message_id = $3, resolved_at = now()
       WHERE id = $1`,
      [conflict.id, decision, answerMessageId],
    );

    return { retired, added };
  });
}

// ---------- คำถามที่ยังไม่ได้คำตอบ ----------

/**
 * คำถามที่ค้างอยู่ของผู้ใช้คนนี้ ส่งให้ AI เป็น context ทุกรอบ
 * เพื่อให้อ่านข้อความสั้น ๆ อย่าง "เฉพาะกลางคืน" ออกว่าเป็นคำตอบของคำถามไหน
 */
export async function listOpenQuestions(userId, limit = 10) {
  const { rows } = await query(
    `SELECT id, topic, rule_ids, question FROM questions
     WHERE user_id = $1 AND status = 'open' ORDER BY id LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/**
 * คำถามที่ถึงเวลาถาม คือยังไม่เคยถาม หรือถามไปแล้วนานพอจะทวงซ้ำได้
 * เรื่องในบทที่เพิ่งคุยกันมาก่อน (topic) เพราะผู้สอนกำลังนึกเรื่องนั้นอยู่พอดี
 * ที่เหลือเอาข้อเก่าสุดก่อน เรื่องที่ค้างมานานจะได้ไม่ถูกดองไว้ท้ายคิวตลอด
 */
export async function dueQuestions(userId, limit, remindMinutes, topic = null) {
  const { rows } = await query(
    `SELECT id, topic, rule_ids, question FROM questions
     WHERE user_id = $1 AND status = 'open'
       AND (asked_at IS NULL OR asked_at < now() - make_interval(mins => $2))
     ORDER BY (topic = $4::text) DESC NULLS LAST, id
     LIMIT $3`,
    [userId, remindMinutes, limit, topic],
  );
  return rows;
}

export async function createQuestions({ userId, topic, questions }) {
  for (const q of questions) {
    await query(
      'INSERT INTO questions (user_id, topic, rule_ids, question) VALUES ($1, $2, $3, $4)',
      [userId, topic, q.rule_ids, q.question],
    );
  }
}

export async function markAsked(ids) {
  if (ids.length === 0) return;
  await query(
    'UPDATE questions SET asked_at = now(), asked_count = asked_count + 1 WHERE id = ANY($1)',
    [ids],
  );
}

export async function closeQuestions({ ids, status, answerMessageId = null }) {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    `UPDATE questions SET status = $2, answer_message_id = $3, resolved_at = now()
     WHERE id = ANY($1) AND status = 'open'`,
    [ids, status, answerMessageId],
  );
  return rowCount;
}

/** ผู้ใช้พิมพ์ "ข้าม" หมายถึงข้ามคำถามชุดที่เพิ่งถามไป ไม่ใช่ล้างคิวทั้งหมด */
export async function skipLastAsked(userId, limit) {
  const { rows } = await query(
    `UPDATE questions SET status = 'skipped', resolved_at = now()
     WHERE id IN (
       SELECT id FROM questions
       WHERE user_id = $1 AND status = 'open' AND asked_at IS NOT NULL
       ORDER BY asked_at DESC, id DESC LIMIT $2
     )
     RETURNING id`,
    [userId, limit],
  );
  return rows.length;
}

/**
 * คำถามที่เคยถามในบทนี้ ไม่ว่าใครถูกถามหรือตอบแล้วหรือยัง ใช้กันถามซ้ำ
 * เอาแค่ชุดหลัง ๆ เพราะรายการนี้ถูกส่งเข้า prompt ทุกครั้ง ถ้าปล่อยให้ยาวไปเรื่อย ๆ จะเปลือง token ฟรี ๆ
 */
export async function askedQuestions(topic, limit = 30) {
  const { rows } = await query(
    'SELECT question FROM questions WHERE topic = $1 ORDER BY id DESC LIMIT $2',
    [topic, limit],
  );
  return rows.reverse();
}

/** คำถามที่ยังค้างคอผู้ใช้คนนี้อยู่กี่ข้อ ใช้ตัดสินว่าควรหาเพิ่มอีกไหม */
export async function countOpenQuestions(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM questions WHERE user_id = $1 AND status = 'open'`,
    [userId],
  );
  return rows[0].n;
}

// ---------- หน้าผู้ดูแล ----------

/** สิ่งที่แก้จากหน้าผู้ดูแลบันทึกในนามนี้ (db.js สร้างชื่อไว้ให้แล้ว) หนังสือจะได้บอกได้ว่าไม่ได้มาจากแชท */
export const ADMIN_ID = 'admin';

/** Postgres ส่ง bigint กับ count ขนาดใหญ่กลับมาเป็นสตริง แปลงเป็นตัวเลขก่อนใช้ */
const numbers = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));

/** ตัวเลขรวมของทั้งระบบ และพื้นที่ที่ฐานข้อมูลใช้ไป */
export async function loadOverview() {
  const [counts, tables] = await Promise.all([
    query(
      `SELECT
         (SELECT count(*) FROM rules WHERE status = 'active')      AS rules_active,
         (SELECT count(*) FROM rules WHERE status = 'retired')     AS rules_retired,
         (SELECT count(*) FROM rules WHERE hidden)                 AS rules_hidden,
         (SELECT count(*) FROM questions WHERE status = 'open')    AS questions_open,
         (SELECT count(*) FROM questions WHERE status = 'answered') AS questions_answered,
         (SELECT count(*) FROM questions WHERE status = 'skipped') AS questions_skipped,
         (SELECT count(*) FROM conflicts WHERE status = 'open')    AS conflicts_open,
         (SELECT count(*) FROM conflicts WHERE status <> 'open')   AS conflicts_closed,
         (SELECT count(*) FROM messages)                           AS messages,
         (SELECT count(*) FROM audio)                              AS voices,
         (SELECT COALESCE(sum(duration_ms), 0) FROM audio)         AS voice_ms,
         (SELECT count(*) FROM users WHERE user_id <> '${ADMIN_ID}') AS users,
         (SELECT count(*) FROM trash)                              AS trash,
         pg_database_size(current_database())                      AS db_bytes`,
    ),
    query(
      `SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema() AND c.relkind = 'r'
       ORDER BY bytes DESC`,
    ),
  ]);
  return {
    counts: numbers(counts.rows[0]),
    tables: tables.rows.map((t) => ({ name: t.name, bytes: Number(t.bytes) })),
  };
}

export async function loadRulesAdmin() {
  const [rules, changes] = await Promise.all([
    query(
      `SELECT r.id, r.topic, r.title, r.summary, r.status, r.hidden, r.created_at, r.retired_at,
              COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
       FROM rules r LEFT JOIN users u ON u.user_id = r.created_by
       ORDER BY r.topic, r.id`,
    ),
    query(
      `SELECT c.kind, c.old_rule_ids, c.new_rule_ids, c.reason, c.created_at,
              COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
       FROM rule_changes c LEFT JOIN users u ON u.user_id = c.user_id
       ORDER BY c.id`,
    ),
  ]);
  return { rules: rules.rows, changes: changes.rows };
}

/** status เป็น null = ทุกสถานะ */
export async function loadQuestionsAdmin(status) {
  const { rows } = await query(
    `SELECT q.id, q.topic, q.rule_ids, q.question, q.status, q.hidden, q.asked_at, q.asked_count,
            q.created_at, q.resolved_at, a.text AS answer_text,
            COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
     FROM questions q
     LEFT JOIN users u ON u.user_id = q.user_id
     LEFT JOIN messages a ON a.id = q.answer_message_id
     WHERE ($1::text IS NULL OR q.status = $1)
     ORDER BY (q.status = 'open') DESC, q.id DESC`,
    [status],
  );
  return rows;
}

export async function loadConflictsAdmin() {
  const { rows } = await query(
    `SELECT c.id, c.status, c.rule_ids, c.explanation, c.question, c.decision, c.created_at,
            m.text AS original_text, a.text AS answer_text,
            COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
     FROM conflicts c
     JOIN messages m ON m.id = c.message_id
     LEFT JOIN messages a ON a.id = c.answer_message_id
     LEFT JOIN users u ON u.user_id = c.user_id
     ORDER BY (c.status = 'open') DESC, c.id DESC`,
  );
  return rows;
}

/** ทุกคนที่เคยคุยกับบอท เรียงจากคนที่คุยล่าสุด */
export async function listUsersAdmin() {
  const { rows } = await query(
    `SELECT u.user_id, COALESCE(u.display_name, '${UNKNOWN_NAME}') AS name,
            (SELECT count(*)::int FROM messages m WHERE m.user_id = u.user_id) AS messages,
            (SELECT count(*)::int FROM rules r WHERE r.created_by = u.user_id AND r.status = 'active') AS rules,
            last.text AS last_text, last.created_at AS last_at
     FROM users u
     LEFT JOIN LATERAL (
       SELECT text, created_at FROM messages m WHERE m.user_id = u.user_id ORDER BY id DESC LIMIT 1
     ) last ON true
     WHERE u.user_id <> '${ADMIN_ID}'
     ORDER BY last.created_at DESC NULLS LAST`,
  );
  return rows;
}

/** แชทของผู้ใช้หนึ่งคน ทีละหน้า before = เอาเฉพาะข้อความที่เก่ากว่า id นี้ */
export async function loadChat(userId, before, limit) {
  const [user, messages] = await Promise.all([
    getUser(userId),
    query(
      `SELECT m.id, m.role, m.text, m.source, m.created_at,
              a.duration_ms, (a.message_id IS NOT NULL) AS has_audio,
              ARRAY(SELECT s.rule_id FROM rule_sources s WHERE s.message_id = m.id ORDER BY s.rule_id) AS rule_ids
       FROM messages m LEFT JOIN audio a ON a.message_id = m.id
       WHERE m.user_id = $1 AND ($2::bigint IS NULL OR m.id < $2)
       ORDER BY m.id DESC
       LIMIT $3`,
      [userId, before, limit],
    ),
  ]);
  return { user, messages: messages.rows.reverse() };
}

/**
 * ไทม์ไลน์ของทุกอย่างที่เปลี่ยน รวมจากสามที่
 * - กฎใหม่ที่มีคนสอนผ่านแชท (กฎที่ไม่ได้เกิดจากการแก้หรือตัดสินข้อขัดแย้ง)
 * - การเปลี่ยนกฎจากแชท
 * - ทุกอย่างที่ผู้ดูแลทำ (admin_log) ส่วนที่ผู้ดูแลทำใน rule_changes ไม่ดึงซ้ำ
 */
export async function loadTimeline(limit) {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT 'teach' AS kind, '#' || r.id || ' ' || r.title AS detail, r.created_at,
              COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
       FROM rules r LEFT JOIN users u ON u.user_id = r.created_by
       WHERE NOT EXISTS (SELECT 1 FROM rule_changes c WHERE r.id = ANY(c.new_rule_ids))
       UNION ALL
       SELECT c.kind,
              concat_ws(' → ',
                NULLIF(array_to_string(ARRAY(SELECT '#' || x FROM unnest(c.old_rule_ids) x), ' '), ''),
                NULLIF(array_to_string(ARRAY(SELECT '#' || x FROM unnest(c.new_rule_ids) x), ' '), '')
              ) || ': ' || c.reason,
              c.created_at, COALESCE(u.display_name, '${UNKNOWN_NAME}')
       FROM rule_changes c LEFT JOIN users u ON u.user_id = c.user_id
       WHERE c.user_id <> '${ADMIN_ID}'
       UNION ALL
       SELECT 'admin:' || a.action, a.detail, a.created_at, 'ผู้ดูแลระบบ'
       FROM admin_log a
     ) t
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function logAdmin(action, detail) {
  await query('INSERT INTO admin_log (action, detail) VALUES ($1, $2)', [action, detail]);
}

export async function getSetting(key) {
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function saveSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** ซ่อนหรือแสดงในหนังสือ คืนแถวที่เปลี่ยน หรือ null ถ้าไม่พบ */
export async function setRuleHidden(ruleId, hidden) {
  const { rows } = await query('UPDATE rules SET hidden = $2 WHERE id = $1 RETURNING id, title', [
    ruleId,
    hidden,
  ]);
  return rows[0] ?? null;
}

export async function setQuestionHidden(questionId, hidden) {
  const { rows } = await query(
    'UPDATE questions SET hidden = $2 WHERE id = $1 RETURNING id, question',
    [questionId, hidden],
  );
  return rows[0] ?? null;
}

/**
 * คำถามค้างที่ไม่เหลือกฎที่ใช้อยู่ให้ถามถึงแล้ว ปิดทิ้งไป บอทจะได้ไม่ทวงเรื่องที่เลิกใช้ไปแล้ว
 * คำถามที่ไม่ได้ผูกกับกฎข้อไหนเลยไม่โดนแตะ คืน id ที่ปิดไป
 */
async function closeOrphanQuestions(db, ruleIds) {
  const { rows } = await db.query(
    `UPDATE questions q SET status = 'skipped', resolved_at = now()
     WHERE q.status = 'open' AND q.rule_ids && $1::int[]
       AND NOT EXISTS (SELECT 1 FROM rules r WHERE r.id = ANY(q.rule_ids) AND r.status = 'active')
     RETURNING q.id`,
    [ruleIds],
  );
  return rows.map((r) => r.id);
}

/** คืน false ถ้ากฎข้อนั้นไม่ได้ใช้อยู่แล้ว */
export async function retireRule({ ruleId, reason }) {
  return withTransaction(async (db) => {
    const retired = await retireRules(db, [ruleId]);
    if (retired.length === 0) return false;
    await db.query(
      `INSERT INTO rule_changes (kind, old_rule_ids, new_rule_ids, reason, user_id)
       VALUES ('retire', $1, '{}', $2, $3)`,
      [retired, reason, ADMIN_ID],
    );
    await closeOrphanQuestions(db, retired);
    return true;
  });
}

/**
 * แก้กฎแบบเดียวกับตอนบอทเพิ่มรายละเอียด คือเลิกใช้ฉบับเดิมแล้วสร้างฉบับใหม่ ประวัติจะได้ไม่หาย
 * ฉบับใหม่ยังนับเป็นของผู้สอนคนเดิมและอ้างคำพูดต้นฉบับชุดเดิม เพราะเนื้อหายังมาจากที่เขาสอน
 * ส่วนใครแก้อะไรเพราะอะไร ดูได้จากประวัติของกฎ
 *
 * คืน id ฉบับใหม่, id เดิมถ้าไม่มีอะไรเปลี่ยน หรือ null ถ้ากฎนั้นไม่ได้ใช้อยู่แล้ว
 */
export async function editRule({ ruleId, rule, reason }) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT created_by, topic, title, summary FROM rules
       WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [ruleId],
    );
    const old = rows[0];
    if (!old) return null;
    if (old.topic === rule.topic && old.title === rule.title && old.summary === rule.summary) {
      return ruleId;
    }

    await retireRules(db, [ruleId]);
    const sources = await db.query('SELECT message_id FROM rule_sources WHERE rule_id = $1', [ruleId]);
    const created = await insertRule(db, rule, old.created_by, sources.rows.map((s) => s.message_id));
    await db.query(
      `INSERT INTO rule_changes (kind, old_rule_ids, new_rule_ids, reason, user_id)
       VALUES ('edit', $1, $2, $3, $4)`,
      [[ruleId], [created.id], reason, ADMIN_ID],
    );
    // คำถามที่ค้างอยู่ต้องชี้ไปที่ฉบับใหม่ ไม่งั้นคำตอบที่ได้มาทีหลังจะหากฎให้รวมเข้าไปไม่เจอ
    await db.query(
      `UPDATE questions SET rule_ids = array_replace(rule_ids, $1::int, $2::int)
       WHERE status = 'open' AND $1::int = ANY(rule_ids)`,
      [ruleId, created.id],
    );
    return created.id;
  });
}

/** คืน false ถ้ากฎข้อนั้นใช้อยู่แล้ว หรือไม่มีอยู่จริง */
export async function restoreRule({ ruleId, reason }) {
  return withTransaction(async (db) => {
    const { rowCount } = await db.query(
      `UPDATE rules SET status = 'active', retired_at = NULL WHERE id = $1 AND status = 'retired'`,
      [ruleId],
    );
    if (rowCount === 0) return false;
    await db.query(
      `INSERT INTO rule_changes (kind, old_rule_ids, new_rule_ids, reason, user_id)
       VALUES ('restore', '{}', $1, $2, $3)`,
      [[ruleId], reason, ADMIN_ID],
    );
    return true;
  });
}

// ---------- ถังขยะ ----------
//
// ลบ = ย้ายแถวออกจากตารางจริงทันที แล้วเก็บสำเนาไว้ในตาราง trash
// ไม่ใช้วิธีติดธง deleted ไว้ในตารางเดิม เพราะต้องไล่แก้ทุก query ของบอทให้กรองออก
// ถ้าพลาดไปสักจุด ของที่ลบแล้วจะหลุดเข้า AI หรือหนังสือ แบบนี้ของที่ลบแล้วไม่อยู่ให้หลุดเลย
//
// ของที่ผูกกันอยู่ (ที่มาของกฎ ประวัติ ไฟล์เสียง) ถูกเก็บลงสำเนาเดียวกัน กู้คืนแล้วจะกลับมาครบ
// ยกเว้นของที่ผูกไว้ถูกลบตามไปแล้ว ก็ข้ามส่วนนั้นไป

async function insertRow(db, table, row) {
  const cols = Object.keys(row);
  await db.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    cols.map((c) => row[c]),
  );
}

async function exists(db, table, id) {
  const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  return rows.length > 0;
}

async function putInTrash(db, kind, itemId, label, snapshot) {
  await db.query('INSERT INTO trash (kind, item_id, label, snapshot) VALUES ($1, $2, $3, $4)', [
    kind,
    itemId,
    label.slice(0, 300),
    JSON.stringify(snapshot),
  ]);
}

/** ลบกฎพร้อมที่มาและประวัติของมัน คืนแถวกฎที่ลบ หรือ null ถ้าไม่พบ */
export async function trashRule(ruleId) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM rules WHERE id = $1 FOR UPDATE', [ruleId]);
    const rule = rows[0];
    if (!rule) return null;

    const sources = await db.query('SELECT * FROM rule_sources WHERE rule_id = $1', [ruleId]);
    const changes = await db.query(
      'SELECT * FROM rule_changes WHERE $1::int = ANY(old_rule_ids) OR $1::int = ANY(new_rule_ids)',
      [ruleId],
    );
    const changeIds = changes.rows.map((c) => c.id);

    await db.query('DELETE FROM rule_sources WHERE rule_id = $1', [ruleId]);
    // ประวัติที่มีกฎข้ออื่นร่วมอยู่ด้วย ตัดแค่เลขข้อนี้ออก กฎข้ออื่นจะได้ไม่เสียประวัติไปด้วย
    await db.query(
      `UPDATE rule_changes
       SET old_rule_ids = array_remove(old_rule_ids, $1::int), new_rule_ids = array_remove(new_rule_ids, $1::int)
       WHERE id = ANY($2)`,
      [ruleId, changeIds],
    );
    await db.query(
      `DELETE FROM rule_changes
       WHERE id = ANY($1) AND cardinality(old_rule_ids) = 0 AND cardinality(new_rule_ids) = 0`,
      [changeIds],
    );
    await db.query('DELETE FROM rules WHERE id = $1', [ruleId]);
    const closedQuestions = await closeOrphanQuestions(db, [ruleId]);

    await putInTrash(db, 'rule', ruleId, `#${ruleId} ${rule.title}`, {
      rule,
      sources: sources.rows,
      changes: changes.rows,
      closedQuestions,
    });
    return rule;
  });
}

async function restoreRuleRows(db, { rule, sources, changes, closedQuestions }) {
  await insertRow(db, 'rules', rule);
  for (const s of sources) {
    await db.query(
      `INSERT INTO rule_sources (rule_id, message_id)
       SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM messages WHERE id = $2)
       ON CONFLICT DO NOTHING`,
      [s.rule_id, s.message_id],
    );
  }

  for (const change of changes) {
    const inOld = change.old_rule_ids.includes(rule.id);
    const inNew = change.new_rule_ids.includes(rule.id);
    if (await exists(db, 'rule_changes', change.id)) {
      await db.query(
        `UPDATE rule_changes SET
           old_rule_ids = CASE WHEN $2 AND NOT ($1::int = ANY(old_rule_ids)) THEN old_rule_ids || $1::int ELSE old_rule_ids END,
           new_rule_ids = CASE WHEN $3 AND NOT ($1::int = ANY(new_rule_ids)) THEN new_rule_ids || $1::int ELSE new_rule_ids END
         WHERE id = $4`,
        [rule.id, inOld, inNew, change.id],
      );
      continue;
    }
    // แถวประวัติหายไปแล้ว (กฎทุกข้อในแถวนั้นถูกลบ) สร้างกลับเฉพาะเลขข้อที่ยังมีอยู่
    const { rows } = await db.query('SELECT id FROM rules WHERE id = ANY($1)', [
      [...change.old_rule_ids, ...change.new_rule_ids],
    ]);
    const alive = new Set(rows.map((r) => r.id));
    const conflictAlive = change.conflict_id && (await exists(db, 'conflicts', change.conflict_id));
    await insertRow(db, 'rule_changes', {
      ...change,
      old_rule_ids: change.old_rule_ids.filter((id) => alive.has(id)),
      new_rule_ids: change.new_rule_ids.filter((id) => alive.has(id)),
      conflict_id: conflictAlive ? change.conflict_id : null,
    });
  }

  await db.query(
    `UPDATE questions SET status = 'open', resolved_at = NULL WHERE id = ANY($1) AND status = 'skipped'`,
    [closedQuestions],
  );
}

/** คืนแถวคำถามที่ลบ หรือ null ถ้าไม่พบ */
export async function trashQuestion(questionId) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('DELETE FROM questions WHERE id = $1 RETURNING *', [questionId]);
    const question = rows[0];
    if (!question) return null;
    await putInTrash(db, 'question', questionId, question.question, { question });
    return question;
  });
}

async function restoreQuestionRows(db, { question }) {
  const answerAlive = question.answer_message_id && (await exists(db, 'messages', question.answer_message_id));
  await insertRow(db, 'questions', {
    ...question,
    answer_message_id: answerAlive ? question.answer_message_id : null,
  });
}

/** คืนแถวข้อขัดแย้งที่ลบ หรือ null ถ้าไม่พบ */
export async function trashConflict(conflictId) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM conflicts WHERE id = $1 FOR UPDATE', [conflictId]);
    const conflict = rows[0];
    if (!conflict) return null;

    // ประวัติกฎที่เกิดจากการตัดสินเรื่องนี้ยังเก็บไว้ แค่ตัดลิงก์ที่ชี้มาหาเรื่องนี้ออก
    const linked = await db.query(
      'UPDATE rule_changes SET conflict_id = NULL WHERE conflict_id = $1 RETURNING id',
      [conflictId],
    );
    await db.query('DELETE FROM conflicts WHERE id = $1', [conflictId]);
    await putInTrash(db, 'conflict', conflictId, conflict.explanation, {
      conflict,
      changeIds: linked.rows.map((r) => r.id),
    });
    return conflict;
  });
}

async function restoreConflictRows(db, { conflict, changeIds }) {
  if (!(await exists(db, 'messages', conflict.message_id))) {
    return 'needs_message';
  }
  const answerAlive = conflict.answer_message_id && (await exists(db, 'messages', conflict.answer_message_id));
  await insertRow(db, 'conflicts', {
    ...conflict,
    answer_message_id: answerAlive ? conflict.answer_message_id : null,
  });
  await db.query('UPDATE rule_changes SET conflict_id = $1 WHERE id = ANY($2) AND conflict_id IS NULL', [
    conflict.id,
    changeIds,
  ]);
  return null;
}

/**
 * ลบข้อความแชทพร้อมไฟล์เสียง
 * ข้อความที่เป็นต้นเรื่องของข้อขัดแย้งลบไม่ได้ เพราะข้อขัดแย้งขาดต้นเรื่องไม่ได้ ต้องลบข้อขัดแย้งก่อน
 * คืน { message } ถ้าลบได้, { blockedBy: [id ข้อขัดแย้ง] } ถ้าลบไม่ได้ หรือ null ถ้าไม่พบ
 */
export async function trashMessage(messageId) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM messages WHERE id = $1 FOR UPDATE', [messageId]);
    const message = rows[0];
    if (!message) return null;

    const origins = await db.query('SELECT id FROM conflicts WHERE message_id = $1', [messageId]);
    if (origins.rows.length > 0) return { blockedBy: origins.rows.map((r) => r.id) };

    const audio = await db.query('SELECT * FROM audio WHERE message_id = $1', [messageId]);
    const sources = await db.query('SELECT * FROM rule_sources WHERE message_id = $1', [messageId]);
    const answeredConflicts = await db.query(
      'UPDATE conflicts SET answer_message_id = NULL WHERE answer_message_id = $1 RETURNING id',
      [messageId],
    );
    const answeredQuestions = await db.query(
      'UPDATE questions SET answer_message_id = NULL WHERE answer_message_id = $1 RETURNING id',
      [messageId],
    );
    await db.query('DELETE FROM audio WHERE message_id = $1', [messageId]);
    await db.query('DELETE FROM rule_sources WHERE message_id = $1', [messageId]);
    await db.query('DELETE FROM messages WHERE id = $1', [messageId]);

    const user = await getUserIn(db, message.user_id);
    const who = message.role === 'assistant' ? 'บอท' : (user?.display_name ?? UNKNOWN_NAME);
    // ไฟล์เสียงเป็น byte ดิบ แปลงเป็น base64 ก่อนเก็บลง JSON
    const voice = audio.rows[0] ? { ...audio.rows[0], data: audio.rows[0].data.toString('base64') } : null;
    await putInTrash(db, 'message', messageId, `${who}: ${message.text || '(เสียง)'}`, {
      message,
      audio: voice,
      sources: sources.rows,
      conflictIds: answeredConflicts.rows.map((r) => r.id),
      questionIds: answeredQuestions.rows.map((r) => r.id),
    });
    return { message };
  });
}

async function getUserIn(db, userId) {
  const { rows } = await db.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return rows[0] ?? null;
}

async function restoreMessageRows(db, { message, audio, sources, conflictIds, questionIds }) {
  await insertRow(db, 'messages', message);
  if (audio) await insertRow(db, 'audio', { ...audio, data: Buffer.from(audio.data, 'base64') });
  for (const s of sources) {
    await db.query(
      `INSERT INTO rule_sources (rule_id, message_id)
       SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM rules WHERE id = $1)
       ON CONFLICT DO NOTHING`,
      [s.rule_id, s.message_id],
    );
  }
  await db.query(
    'UPDATE conflicts SET answer_message_id = $1 WHERE id = ANY($2) AND answer_message_id IS NULL',
    [message.id, conflictIds],
  );
  await db.query(
    'UPDATE questions SET answer_message_id = $1 WHERE id = ANY($2) AND answer_message_id IS NULL',
    [message.id, questionIds],
  );
}

export async function listTrash() {
  const { rows } = await query(
    'SELECT id, kind, item_id, label, deleted_at FROM trash ORDER BY deleted_at DESC, id DESC',
  );
  return rows;
}

const RESTORERS = {
  rule: restoreRuleRows,
  question: restoreQuestionRows,
  conflict: restoreConflictRows,
  message: restoreMessageRows,
};

/**
 * กู้ของในถังขยะกลับไปที่เดิม
 * คืน { item } ถ้าสำเร็จ, { error } ถ้ากู้ไม่ได้ (ของยังอยู่ในถัง) หรือ null ถ้าไม่พบ
 */
export async function restoreFromTrash(trashId) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM trash WHERE id = $1 FOR UPDATE', [trashId]);
    const item = rows[0];
    if (!item) return null;

    const error = await RESTORERS[item.kind](db, item.snapshot);
    if (error) return { error, item };
    await db.query('DELETE FROM trash WHERE id = $1', [trashId]);
    return { item };
  });
}

/** ลบถาวร คืนจำนวนที่ลบไป ids เป็น null = ล้างทั้งถัง */
export async function purgeTrash(ids) {
  const { rowCount } = ids
    ? await query('DELETE FROM trash WHERE id = ANY($1)', [ids])
    : await query('DELETE FROM trash');
  return rowCount;
}

// ---------- หนังสือ ----------

/** ดึงทุกอย่างที่หนังสือต้องใช้ในครั้งเดียว */
export async function loadBook() {
  const [rules, sources, changes, conflicts, questions, chapters, settings] = await Promise.all([
    query(
      `SELECT r.*, COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
       FROM rules r LEFT JOIN users u ON u.user_id = r.created_by
       ORDER BY r.id`,
    ),
    query(
      `SELECT s.rule_id, m.id AS message_id, m.text, m.source, m.created_at,
              COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
       FROM rule_sources s
       JOIN messages m ON m.id = s.message_id
       LEFT JOIN users u ON u.user_id = m.user_id
       ORDER BY m.id`,
    ),
    query(
      `SELECT c.*, COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
       FROM rule_changes c LEFT JOIN users u ON u.user_id = c.user_id
       ORDER BY c.id`,
    ),
    query(
      `SELECT c.*, m.text AS original_text, m.source AS original_source,
              a.text AS answer_text, a.source AS answer_source,
              COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
       FROM conflicts c
       JOIN messages m ON m.id = c.message_id
       LEFT JOIN messages a ON a.id = c.answer_message_id
       LEFT JOIN users u ON u.user_id = c.user_id
       ORDER BY c.id`,
    ),
    query(
      `SELECT q.topic, q.rule_ids, q.question, q.asked_at,
              COALESCE(u.display_name, '${UNKNOWN_NAME}') AS author
       FROM questions q LEFT JOIN users u ON u.user_id = q.user_id
       WHERE q.status = 'open' AND NOT q.hidden
       ORDER BY q.id`,
    ),
    query('SELECT topic, source_hash, content FROM chapters'),
    getSetting('book'),
  ]);

  return {
    rules: rules.rows,
    sources: sources.rows,
    changes: changes.rows,
    conflicts: conflicts.rows,
    questions: questions.rows,
    chapters: new Map(chapters.rows.map((c) => [c.topic, c])),
    settings,
  };
}

export async function saveChapter(topic, sourceHash, content) {
  await query(
    `INSERT INTO chapters (topic, source_hash, content) VALUES ($1, $2, $3)
     ON CONFLICT (topic) DO UPDATE
       SET source_hash = EXCLUDED.source_hash, content = EXCLUDED.content, updated_at = now()`,
    [topic, sourceHash, JSON.stringify(content)],
  );
}
