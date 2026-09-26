import { compressImageFile } from './imageCompression';

const CEREBRO_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const CEREBRO_IMAGE_TARGET_BYTES = 8 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const UPLOADABLE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const inferImageMimeType = (file: File): string => {
  const suppliedMimeType = file.type.trim().toLowerCase();
  if (suppliedMimeType && suppliedMimeType !== 'application/octet-stream') {
    return suppliedMimeType;
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? suppliedMimeType;
};

/** Converts iPhone photos and reduces camera images before the Cerebro upload. */
export const prepareCerebroImageUpload = async (file: File): Promise<File> => {
  const inferredMimeType = inferImageMimeType(file);
  if (!inferredMimeType.startsWith('image/')) {
    throw new Error('Choose a JPG, PNG, WEBP, GIF, HEIC, or HEIF image.');
  }

  const typedFile = inferredMimeType === file.type.toLowerCase()
    ? file
    : new File([file], file.name, { type: inferredMimeType, lastModified: file.lastModified });

  // Keep animated GIFs intact; canvas conversion would retain only one frame.
  const preparedFile = inferredMimeType === 'image/gif'
    ? typedFile
    : await compressImageFile(typedFile, {
        maxWidth: 2400,
        maxHeight: 2400,
        maxSizeBytes: CEREBRO_IMAGE_TARGET_BYTES,
        quality: 0.86,
        outputMimeType: 'image/jpeg',
      });

  if (!UPLOADABLE_MIME_TYPES.has(preparedFile.type.toLowerCase())) {
    throw new Error('This iPhone photo could not be converted. Try exporting it as a JPG and upload it again.');
  }
  if (preparedFile.size > CEREBRO_IMAGE_MAX_BYTES) {
    throw new Error('The image is still larger than 10 MB. Choose a smaller image and try again.');
  }

  return preparedFile;
};
