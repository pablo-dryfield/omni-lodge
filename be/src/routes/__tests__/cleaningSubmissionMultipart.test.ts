jest.mock('../../middleware/authMiddleware.js', () => ({ __esModule: true, default: (req: any, _res: any, next: () => void) => {
  req.authContext = { id: 7, roleSlug: 'guide' }; next();
} }));
jest.mock('../../controllers/cleaningSubmissionController.js', () => ({
  getMyCleaningSubmissions: (_req: any, res: any) => res.json({}),
  getCleaningSubmissionDetail: (_req: any, res: any) => res.json({}),
  patchCleaningPhotoReview: (_req: any, res: any) => res.json({}),
  streamCleaningPhoto: (_req: any, res: any) => res.json({}),
  postWaiveCanceledCleaningTask: (_req: any, res: any) => res.json({ status: 'waived' }),
  postCleaningPhoto: (req: any, res: any) => res.json({ field: req.file?.fieldname, bytes: req.file?.buffer?.length, revision: req.body.expectedRevision }),
}));
import express from 'express';
import request from 'supertest';
import router from '../cleaningSubmissionRoutes.js';
const app = express(); app.use('/api/cleaningSubmissions', router);
const route = '/api/cleaningSubmissions/1/slots/house-1/photos';
describe('real multer cleaning photo multipart parser', () => {
  it('accepts exactly the file plus expectedRevision sent by the UI', async () => {
    const result = await request(app).post(route).field('expectedRevision', '3').attach('file', Buffer.from('photo'), 'photo.jpg');
    expect(result.status).toBe(200); expect(result.body).toEqual({ field: 'file', bytes: 5, revision: '3' });
  });
  it('accepts file-first ordering as well', async () => {
    const result = await request(app).post(route).attach('file', Buffer.from('photo'), 'photo.jpg').field('expectedRevision', '3');
    expect(result.status).toBe(200);
  });
  it('rejects extra fields and extra files', async () => {
    const extraField = await request(app).post(route).field('expectedRevision', '3').field('unexpected', 'value').attach('file', Buffer.from('photo'), 'photo.jpg');
    expect(extraField.status).toBe(400);
    const extraFile = await request(app).post(route).field('expectedRevision', '3').attach('file', Buffer.from('photo'), 'photo.jpg').attach('file', Buffer.from('photo'), 'second.jpg');
    expect(extraFile.status).toBe(400);
  });
  it('rejects oversized or incorrectly named file parts', async () => {
    const tooBig = await request(app).post(route).field('expectedRevision', '3').attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'photo.jpg');
    expect(tooBig.status).toBe(413);
    const wrongPart = await request(app).post(route).field('expectedRevision', '3').attach('evidence', Buffer.from('photo'), 'photo.jpg');
    expect(wrongPart.status).toBe(400);
  });
  it('routes the dedicated canceled-task waiver separately from photo submission endpoints', async () => {
    const result = await request(app).post('/api/cleaningSubmissions/tasks/12/waive').send({ reason: 'Canceled', expectedUpdatedAt: '2026-09-07T10:00:00Z' });
    expect(result.status).toBe(200); expect(result.body).toEqual({ status: 'waived' });
  });
});
