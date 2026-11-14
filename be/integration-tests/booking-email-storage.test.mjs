import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sequelize from '../src/config/database.ts';
import BookingEmail from '../src/models/BookingEmail.ts';
import { saveEmailRecord } from '../src/services/bookings/bookingIngestionService.ts';

test('concurrent ingestion saves one Gmail snapshot and preserves terminal state', {
  skip: process.env.BOOKING_EMAIL_STORAGE_TEST !== 'true',
}, async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST));
  assert.equal(process.env.DISABLE_OUTBOUND_EMAIL, 'true');
  assert.equal(process.env.DISABLE_BACKGROUND_JOBS, 'true');
  const messageId = 'qa-ingestion-' + randomUUID();
  const payload = { sourceAccount: 'primary', message: { id: messageId, threadId: messageId, internalDate: String(Date.now()),
    snippet: 'Concurrent local fixture', labelIds: ['INBOX'], sizeEstimate: 400, payload: { headers: [] } },
    headers: { from: 'booking@example.invalid', subject: 'Local ingestion fixture' }, textBody: 'Local fixture', htmlBody: null };
  try {
    const rows = await Promise.allSettled(Array.from({ length: 12 }, () => saveEmailRecord(payload)));
    const failed = rows.filter(row => row.status === 'rejected');
    assert.deepEqual(failed.map(row => ({ name: row.reason.name, message: row.reason.message })), [], 'Concurrent saves must recover the unique message ID winner.');
    assert.equal(new Set(rows.map(row => String(row.value.id))).size, 1);
    assert.equal(await BookingEmail.count({ where: { messageId } }), 1);
    await BookingEmail.update({ ingestionStatus: 'processed' }, { where: { messageId } });
    const saved = await saveEmailRecord({ ...payload, message: { ...payload.message, snippet: 'Metadata refreshed' } });
    assert.equal(saved.ingestionStatus, 'processed');
    assert.equal(saved.snippet, 'Metadata refreshed');
  } finally {
    await BookingEmail.destroy({ where: { messageId } });
    await sequelize.close();
  }
});
