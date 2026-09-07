import { createHash } from 'crypto';
import sharp from 'sharp';
import HttpError from '../errors/HttpError.js';
import { CLEANING_PHOTO_MAX_BYTES, CLEANING_PHOTO_MAX_PIXELS } from './cleaningSubmissionRulesService.js';

/** Decode and re-encode pixels; the submitted MIME type and filename are not trusted. */
export const normalizeCleaningPhoto = async (input: Buffer) => {
  if (!Buffer.isBuffer(input) || !input.length) throw new HttpError(400, 'Choose a photo to upload.');
  if (input.length > CLEANING_PHOTO_MAX_BYTES) throw new HttpError(413, 'Cleaning photos must be no larger than 10 MiB.');
  const isJpeg = input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
  const isPng = input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw new HttpError(400, 'Use a JPEG, PNG, or WebP photo. SVG, HEIC, and animated images are not supported.');
  try {
    const image = sharp(input, { failOn: 'warning', limitInputPixels: CLEANING_PHOTO_MAX_PIXELS });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height
      || metadata.width * metadata.height > CLEANING_PHOTO_MAX_PIXELS || (metadata.pages ?? 1) > 1) {
      throw new HttpError(400, 'Use one still photo no larger than 24 megapixels.');
    }
    // sharp strips EXIF/location/other metadata by default. Only normalized pixels leave this service.
    const { data, info } = await image.rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
    if (data.length > CLEANING_PHOTO_MAX_BYTES) throw new HttpError(413, 'The normalized photo is too large. Choose a smaller photo.');
    return { data, mimeType: 'image/jpeg', fileName: 'cleaning-photo.jpg', width: info.width, height: info.height,
      sha256: createHash('sha256').update(data).digest('hex') };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'This photo could not be safely decoded. Upload a valid JPEG, PNG, or WebP photo.');
  }
};
