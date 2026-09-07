import { assertStoredTaskImagesUnchanged, assertWorkflowMetadataUnchanged } from '../assistantManagerTaskEvidenceIntegrityService.js';

const image = { id: 'photo-1', ruleKey: 'photo', type: 'image', subjectUserId: 10,
  storagePath: 'drive:abc', driveFileId: 'abc', uploadedBy: 10, uploadedAt: '2026-09-07T10:00:00.000Z' };
describe('task image integrity outside upload endpoints', () => {
  it('accepts unchanged uploaded evidence and normal link edits', () => {
    expect(() => assertStoredTaskImagesUnchanged({ evidenceItems: [image] }, {
      evidenceItems: [{ ...image, valid: true, subjectName: 'Display name' }, { id: 'link', type: 'link', url: 'https://example.com' }],
    })).not.toThrow();
  });
  it.each(['storagePath', 'driveFileId', 'uploadedBy', 'uploadedAt', 'subjectUserId', 'ruleKey', 'fileSize', 'mimeType'])('rejects forged %s', (field) => {
    expect(() => assertStoredTaskImagesUnchanged({ evidenceItems: [image] }, {
      evidenceItems: [{ ...image, [field]: 'forged' }],
    })).toThrow('photo upload action');
  });
  it('rejects new images introduced through metadata or manual task creation', () => {
    expect(() => assertStoredTaskImagesUnchanged({}, { evidenceItems: [image] })).toThrow();
  });
  it('rejects duplicate IDs and leaves removal authorization to reference guards', () => {
    expect(() => assertStoredTaskImagesUnchanged({ evidenceItems: [image] }, { evidenceItems: [image, image] })).toThrow('unique');
    expect(() => assertStoredTaskImagesUnchanged({ evidenceItems: [image] }, { evidenceItems: [] })).not.toThrow();
  });
  it('does not let callers fabricate or clear workflow state', () => {
    const meta = { cleaningPhotoWorkflow: { version: 1, managed: true } };
    expect(() => assertWorkflowMetadataUnchanged({}, meta)).toThrow();
    expect(() => assertWorkflowMetadataUnchanged(meta, {})).toThrow();
    expect(() => assertWorkflowMetadataUnchanged(meta, { ...meta, notes: 'comment' })).not.toThrow();
  });
});
