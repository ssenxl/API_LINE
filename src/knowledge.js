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

export async function cancelConflict({ conflictId, answerMessageId, decision }) {
  await query(
    `UPDATE conflicts
     SET status = 'cancelled', decision = $2, answer_message_id = $3, resolved_at = now()
     WHERE id = $1`,
    [conflictId, decision, answerMessageId],
  );
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
  if (ids.length === 0) return;
  await query(
    `UPDATE questions SET status = $2, answer_message_id = $3, resolved_at = now()
     WHERE id = ANY($1) AND status = 'open'`,
    [ids, status, answerMessageId],
  );
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

// ---------- หนังสือ ----------

/** ดึงทุกอย่างที่หนังสือต้องใช้ในครั้งเดียว */
export async function loadBook() {
  const [rules, sources, changes, conflicts, questions, chapters] = await Promise.all([
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
       WHERE q.status = 'open'
       ORDER BY q.id`,
    ),
    query('SELECT topic, source_hash, content FROM chapters'),
  ]);

  return {
    rules: rules.rows,
    sources: sources.rows,
    changes: changes.rows,
    conflicts: conflicts.rows,
    questions: questions.rows,
    chapters: new Map(chapters.rows.map((c) => [c.topic, c])),
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
