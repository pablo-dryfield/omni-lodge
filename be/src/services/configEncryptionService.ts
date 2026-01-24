import crypto from 'crypto';
import HttpError from '../errors/HttpError.js';

type EncryptedPayload = {
  encryptedValue: string;
  iv: string;
  tag: string;
};

const toUint8Array = (value: Buffer): Uint8Array =>
  new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return merged;
};

const resolveEncryptionKey = (): crypto.KeyObject => {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) {
    throw new HttpError(500, 'CONFIG_ENCRYPTION_KEY is not configured');
  }
  const digest = crypto.createHash('sha256').update(raw, 'utf8').digest();
  return crypto.createSecretKey(toUint8Array(digest));
};

export const encryptSecret = (plainText: string): EncryptedPayload => {
  const key = resolveEncryptionKey();
  const ivBuffer = crypto.randomBytes(12);
  const iv = toUint8Array(ivBuffer);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = concatBytes([
    toUint8Array(cipher.update(plainText, 'utf8')),
    toUint8Array(cipher.final()),
  ]);
  const tag = toUint8Array(cipher.getAuthTag());

  return {
    encryptedValue: Buffer.from(encrypted).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    tag: Buffer.from(tag).toString('base64'),
  };
};

export const decryptSecret = (payload: EncryptedPayload): string => {
  const key = resolveEncryptionKey();
  const iv = toUint8Array(Buffer.from(payload.iv, 'base64'));
  const tag = toUint8Array(Buffer.from(payload.tag, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = concatBytes([
    toUint8Array(decipher.update(toUint8Array(Buffer.from(payload.encryptedValue, 'base64')))),
    toUint8Array(decipher.final()),
  ]);
  return Buffer.from(decrypted).toString('utf8');
};
