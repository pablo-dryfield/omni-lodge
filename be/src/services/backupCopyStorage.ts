import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import HttpError from '../errors/HttpError.js';

export type CopyIdentity = {
  id: string;
  filename: string;
  location: 'local' | 'drive';
  sizeBytes: number;
  modifiedAt: string;
  sha256Checksum?: string;
};
export const backupCopyFingerprint = (copy: CopyIdentity): string =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        id: copy.id,
        filename: copy.filename,
        location: copy.location,
        bytes: copy.sizeBytes,
        modifiedAt: copy.modifiedAt,
        checksum: copy.sha256Checksum || null,
      }),
    )
    .digest('hex');
export async function validatedLocalBackup(
  root: string,
  filename: string,
  expected?: Pick<CopyIdentity, 'sizeBytes' | 'modifiedAt'>,
): Promise<string> {
  if (
    !filename ||
    filename !== path.basename(filename) ||
    /[\\/\u0000-\u001f\u007f]/.test(filename) ||
    !filename.endsWith('.backup')
  )
    throw new HttpError(
      400,
      'Choose a single backup file inside the configured server directory.',
    );
  const canonicalRoot = await fs.realpath(root),
    candidate = path.join(canonicalRoot, filename),
    stat = await fs.lstat(candidate);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    path.dirname(await fs.realpath(candidate)) !== canonicalRoot
  )
    throw new HttpError(
      403,
      'Backup links and files outside the configured directory are not allowed.',
    );
  if (
    expected &&
    (stat.size !== expected.sizeBytes ||
      stat.mtime.toISOString() !== expected.modifiedAt)
  )
    throw new HttpError(
      409,
      'The server backup changed. Refresh and review the current copy.',
    );
  return candidate;
}
export async function streamLocalBackup(
  root: string,
  copy: CopyIdentity,
  destination: NodeJS.WritableStream,
): Promise<void> {
  const filename = await validatedLocalBackup(root, copy.filename, copy);
  await pipeline(createReadStream(filename), destination);
}
export async function deleteLocalBackup(
  root: string,
  copy: CopyIdentity,
): Promise<void> {
  const filename = await validatedLocalBackup(root, copy.filename, copy);
  await fs.unlink(filename);
}
