import pg from 'pg';
import { config } from './config.js';

/**
 * ฐานข้อมูล Postgres (ใช้ Neon แพ็กเกจฟรี)
 * ต้องใช้ฐานข้อมูลภายนอก เพราะ Render แพ็กเกจฟรีจะล้างไฟล์ทุกครั้งที่ restart หรือ deploy
 */
const pool = new pg.Pool({
  connectionString: config.database.url,
  max: 5,
  idleTimeoutMillis: 30_000,
});

// Neon ตัด connection ที่ว่างนาน ๆ ทิ้งเอง ถ้าไม่ดัก error นี้ process จะล้มทั้งตัว
pool.on('error', (err) => console.warn('[db] connection ที่ว่างอยู่หลุด:', err.message));

export function query(text, params) {
  return pool.query(text, params);
}

/** ทำหลายคำสั่งให้สำเร็จพร้อมกันทั้งหมด หรือไม่สำเร็จเลยสักอัน */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * สร้างตารางถ้ายังไม่มี เรียกทุกครั้งตอนเปิดเซิร์ฟเวอร์ รันซ้ำได้ไม่พัง
 *
 * หลักการสำคัญ: ไม่ลบอะไรทิ้งเลย กฎที่เลิกใช้แค่เปลี่ยน status เป็น retired
 * เพื่อให้หนังสือเล่าย้อนได้ว่าเคยเป็นอย่างไร เปลี่ยนเพราะอะไร ใครตัดสิน
 */
export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id          TEXT PRIMARY KEY,
      display_name     TEXT,
      context_reset_at TIMESTAMPTZ,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ทุกข้อความที่คุยกัน ทั้งฝั่งผู้ใช้และบอท นี่คือ "ต้นฉบับ" ที่ผู้ใช้ให้ข้อมูลมา
    CREATE TABLE IF NOT EXISTS messages (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      text       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS messages_user_time ON messages (user_id, created_at DESC);
    -- text = พิมพ์มา, voice = ถอดจากเสียง (ไฟล์เสียงต้นฉบับอยู่ในตาราง audio)
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'text';

    -- ไฟล์เสียงต้นฉบับ แยกตารางไว้ ไม่ให้การอ่านข้อความทั่วไปต้องลากไฟล์ใหญ่มาด้วย
    CREATE TABLE IF NOT EXISTS audio (
      message_id  BIGINT PRIMARY KEY REFERENCES messages (id),
      mime        TEXT   NOT NULL,
      duration_ms INT,
      size_bytes  INT    NOT NULL,
      data        BYTEA  NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- กฎที่ AI สรุปเป็นภาษาคนแล้ว
    CREATE TABLE IF NOT EXISTS rules (
      id         SERIAL PRIMARY KEY,
      topic      TEXT NOT NULL,
      title      TEXT NOT NULL,
      summary    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      retired_at TIMESTAMPTZ
    );

    -- กฎแต่ละข้อมาจากข้อความไหนของผู้ใช้บ้าง
    CREATE TABLE IF NOT EXISTS rule_sources (
      rule_id    INT    NOT NULL REFERENCES rules (id),
      message_id BIGINT NOT NULL REFERENCES messages (id),
      PRIMARY KEY (rule_id, message_id)
    );

    -- เรื่องที่ขัดแย้งกับของเดิม ถามผู้ใช้กลับไปแล้วรอคำตอบ
    CREATE TABLE IF NOT EXISTS conflicts (
      id                SERIAL PRIMARY KEY,
      user_id           TEXT   NOT NULL,
      message_id        BIGINT NOT NULL REFERENCES messages (id),
      proposed          JSONB  NOT NULL,
      rule_ids          INT[]  NOT NULL DEFAULT '{}',
      explanation       TEXT   NOT NULL,
      question          TEXT   NOT NULL,
      status            TEXT   NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'resolved', 'cancelled')),
      decision          TEXT,
      answer_message_id BIGINT REFERENCES messages (id),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at       TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS conflicts_open ON conflicts (user_id) WHERE status = 'open';

    -- ช่องโหว่ที่บอทวิเคราะห์เจอจากกฎที่มีอยู่ ถามผู้สอนกลับไปแล้วรอคำตอบ
    -- เก็บลงตารางเพราะถ้าผู้สอนยังไม่ตอบ ต้องทวงซ้ำได้ ไม่ใช่ถามครั้งเดียวแล้วหายไป
    CREATE TABLE IF NOT EXISTS questions (
      id                SERIAL PRIMARY KEY,
      user_id           TEXT   NOT NULL,
      topic             TEXT   NOT NULL,
      rule_ids          INT[]  NOT NULL DEFAULT '{}',
      question          TEXT   NOT NULL,
      status            TEXT   NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'answered', 'skipped')),
      answer_message_id BIGINT REFERENCES messages (id),
      asked_at          TIMESTAMPTZ,
      asked_count       INT    NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at       TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS questions_open ON questions (user_id) WHERE status = 'open';
    CREATE INDEX IF NOT EXISTS questions_topic ON questions (topic);

    -- ประวัติการเปลี่ยนกฎ: กฎเก่าชุดไหนถูกแทนด้วยกฎใหม่ชุดไหน เพราะอะไร
    CREATE TABLE IF NOT EXISTS rule_changes (
      id           SERIAL PRIMARY KEY,
      kind         TEXT  NOT NULL CHECK (kind IN ('refine', 'conflict')),
      old_rule_ids INT[] NOT NULL,
      new_rule_ids INT[] NOT NULL,
      reason       TEXT  NOT NULL,
      conflict_id  INT REFERENCES conflicts (id),
      user_id      TEXT  NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- เนื้อหาแต่ละบทที่ AI เรียบเรียงไว้ เก็บไว้ไม่ต้องให้ AI เขียนใหม่ทุกครั้งที่เปิดหนังสือ
    CREATE TABLE IF NOT EXISTS chapters (
      topic       TEXT PRIMARY KEY,
      source_hash TEXT  NOT NULL,
      content     JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
