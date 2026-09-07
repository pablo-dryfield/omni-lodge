import HttpError from '../errors/HttpError.js';

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const items = (meta: unknown): Record<string, unknown>[] => {
  const value = objectValue(meta).evidenceItems;
  return Array.isArray(value) ? value.map(objectValue) : [];
};
const SERVER_IMAGE_FIELDS = ['id', 'type', 'ruleKey', 'subjectUserId', 'fileName', 'mimeType',
  'fileSize', 'storagePath', 'driveFileId', 'driveWebViewLink', 'uploadedAt', 'uploadedBy'] as const;

/** Only the upload endpoint may introduce an image or change its storage/ownership metadata. */
export function assertStoredTaskImagesUnchanged(currentMeta: unknown, nextMeta: unknown): void {
  const current = new Map(items(currentMeta).filter((item) => item.type === 'image').map((item) => [item.id, item]));
  const seen = new Set<unknown>();
  for (const item of items(nextMeta)) {
    if (seen.has(item.id)) throw new HttpError(400, 'Evidence identifiers must be unique.');
    seen.add(item.id);
    if (item.type !== 'image') continue;
    const stored = current.get(item.id);
    if (!stored || SERVER_IMAGE_FIELDS.some((key) => (stored[key] ?? null) !== (item[key] ?? null))) {
      throw new HttpError(409, 'Photo evidence must be uploaded using the photo upload action. Refresh to use the saved photo.');
    }
  }
}

export function assertWorkflowMetadataUnchanged(currentMeta: unknown, nextMeta: unknown): void {
  const current = objectValue(currentMeta);
  const next = objectValue(nextMeta);
  if (JSON.stringify(current.cleaningPhotoWorkflow ?? null) !== JSON.stringify(next.cleaningPhotoWorkflow ?? null)) {
    throw new HttpError(409, 'Cleaning review metadata can only be changed by the cleaning workflow.');
  }
}
