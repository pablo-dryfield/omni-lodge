import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { up, down, BACKFILL_SQL } from '../src/migrations/202611160001-cleaning-attendance-resolution.ts';

test('cleaning attendance migration preserves manual decisions and only repairs completed exact approved proof', async () => {
  const local = fs.existsSync('.env.dev') ? dotenv.parse(fs.readFileSync('.env.dev')) : {};
  const env = { ...local, ...process.env };
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), 'Use a local PostgreSQL test connection');
  const client = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT || 5432), database: env.DB_NAME,
    user: env.DB_USER, password: env.DB_PASSWORD });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = `cleaning_attendance_test_${process.pid}`;
    await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path = "${schema}"`);
    await client.query(`
      CREATE TABLE schedule_weeks (id int PRIMARY KEY, state text);
      CREATE TABLE shift_instances (id int PRIMARY KEY, schedule_week_id int, shift_type_id int, date date, time_start time, time_end time);
      CREATE TABLE shift_assignments (id int PRIMARY KEY, user_id int, shift_instance_id int);
      CREATE TABLE am_task_logs (id int PRIMARY KEY, status text, task_date date, completed_at timestamptz, meta jsonb);
      CREATE TABLE cleaning_submissions (id int PRIMARY KEY, task_log_id int, shift_assignment_id int, user_id int,
        required_slots jsonb, schedule_snapshot jsonb, status text CHECK (status IN ('approved','awaiting_upload','awaiting_review','escalated')));
      CREATE TABLE cleaning_photo_versions (id int PRIMARY KEY, submission_id int, slot_key text, version int, status text, reviewed_by int, reviewed_at timestamptz);
      CREATE TABLE volunteer_shift_attendance (id serial PRIMARY KEY, shift_assignment_id int UNIQUE, subject_user_id int,
        status text, notes text, recorded_by int, recorded_at timestamptz, revision int, evidence_task_log_id int,
        evidence_shift_instance_id int, evidence_shift_type_id int, evidence_rule_key text, evidence_file_id text,
        check_kind text, expected_time text, late_minutes int, created_at timestamptz, updated_at timestamptz,
        CONSTRAINT volunteer_attendance_proof_ck CHECK (check_kind IS NULL OR check_kind IN ('meeting_point','promotion_chat')));
      CREATE TABLE audit_logs (id serial PRIMARY KEY, actor_id int, action text, entity text, entity_id text, meta_json jsonb, created_at timestamptz);
      INSERT INTO schedule_weeks VALUES (1,'published'),(2,'draft');
      INSERT INTO shift_instances SELECT n, CASE WHEN n=7 THEN 2 ELSE 1 END, 7, '2026-11-13', '17:00', '18:00' FROM generate_series(1,12) n;
      INSERT INTO shift_assignments SELECT n, n+100, n FROM generate_series(1,12) n;
      INSERT INTO am_task_logs SELECT n, CASE WHEN n=3 THEN 'pending' ELSE 'completed' END, '2026-11-13', '2026-11-13T17:10Z',
        CASE WHEN n=9 THEN '{}'::jsonb ELSE '{"cleaningPhotoWorkflow":{"managed":true}}'::jsonb END FROM generate_series(1,12) n;
      INSERT INTO cleaning_submissions SELECT n,n,n,n+100,'[{"key":"chat"}]',
        jsonb_build_object('assignmentId',n,'shiftInstanceId',n,'shiftTypeId',7,'date','2026-11-13','timeStart','17:00:00','timeEnd','18:00:00'),
        CASE WHEN n=4 THEN 'awaiting_review' ELSE 'approved' END FROM generate_series(1,12) n;
      INSERT INTO cleaning_photo_versions SELECT n,n,'chat',1,'approved',9,'2026-11-13T17:05Z' FROM generate_series(1,12) n WHERE n<>8;
      INSERT INTO cleaning_photo_versions VALUES (100,5,'chat',2,'rejected',9,'2026-11-13T17:06Z');
      UPDATE shift_assignments SET user_id=999 WHERE id=6;
      UPDATE cleaning_submissions SET schedule_snapshot = schedule_snapshot || '{"date":"2026-11-12"}' WHERE id=10;
      UPDATE cleaning_submissions SET schedule_snapshot = schedule_snapshot || '{"timeStart":"16:00:00"}' WHERE id=11;
      UPDATE cleaning_submissions SET required_slots = '[{"key":"chat"},{"key":"kitchen"}]' WHERE id=12;
      INSERT INTO volunteer_shift_attendance (shift_assignment_id,subject_user_id,status,notes,recorded_by,recorded_at,revision)
        VALUES (2,102,'late','Existing manual decision',9,NOW(),3);
    `);
    const context = { sequelize: { transaction: async (fn) => fn({}), query: async (sql) => {
      const result = await client.query(sql); return [result.rows, result];
    } } };
    await up({ context });
    const rows = (await client.query('SELECT * FROM volunteer_shift_attendance ORDER BY shift_assignment_id')).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'attended'); assert.equal(rows[0].subject_user_id, 101);
    assert.equal(rows[0].evidence_shift_instance_id, 1); assert.equal(rows[0].check_kind, 'cleaning');
    assert.equal(rows[0].recorded_by, null);
    assert.equal(rows[1].status, 'late'); assert.equal(rows[1].notes, 'Existing manual decision'); assert.equal(rows[1].revision, 3);
    assert.equal((await client.query('SELECT * FROM audit_logs')).rowCount, 1);
    await client.query(BACKFILL_SQL);
    assert.equal((await client.query('SELECT * FROM audit_logs')).rowCount, 1, 'repair is idempotent');
    await client.query(`UPDATE cleaning_submissions SET status='excused', attendance_resolution=
      '{"status":"excused","reason":"Unwell","recordedBy":9,"recordedAt":"2026-11-13T17:00Z"}' WHERE id=8`);
    await client.query('SAVEPOINT invalid_resolution');
    await assert.rejects(client.query(`UPDATE cleaning_submissions SET attendance_resolution='{}' WHERE id=8`), /cleaning_attendance_resolution_ck/);
    await client.query('ROLLBACK TO SAVEPOINT invalid_resolution');
    await client.query('SAVEPOINT cannot_undo');
    await assert.rejects(down({ context }), /Cannot remove cleaning attendance/);
    await client.query('ROLLBACK TO SAVEPOINT cannot_undo');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
});
