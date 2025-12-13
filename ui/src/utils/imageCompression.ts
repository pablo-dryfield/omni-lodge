type ImageCompressionOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxSizeBytes?: number;
  force?: boolean;
  outputMimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
};

const DEFAULT_OPTIONS: Required<Omit<ImageCompressionOptions, 'outputMimeType'>> = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.82,
  maxSizeBytes: 800 * 1024,
  force: false,
};

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const stripExtension = (filename: string): string => filename.replace(/\.[^/.]+$/, '');

const renameFileByMime = (filename: string, mimeType: string): string => {
  const extension = MIME_EXTENSION_MAP[mimeType];
  if (!extension) {
    return filename;
  }
  return `${stripExtension(filename)}.${extension}`;
};

const canvasToBlob = (canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to compress image'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });

const loadImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to read image file'));
    };
    image.src = url;
  });

const isImageBitmap = (value: ImageBitmap | HTMLImageElement): value is ImageBitmap =>
  typeof (value as ImageBitmap).close === 'function';

const getSourceDimensions = (source: ImageBitmap | HTMLImageElement) => {
  if (isImageBitmap(source)) {
    return { width: source.width, height: source.height };
  }
  return {
    width: source.naturalWidth || source.width,
    height: source.naturalHeight || source.height,
  };
};

const drawImageToCanvas = (
  source: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas context is unavailable');
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (isImageBitmap(source)) {
    source.close();
  }
  return canvas;
};

const loadImageSource = async (file: File): Promise<ImageBitmap | HTMLImageElement> => {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fallback to HTMLImageElement below.
    }
  }
  return loadImageElement(file);
};

export const compressImageFile = async (
  file: File,
  options: ImageCompressionOptions = {},
): Promise<File> => {
  if (!file.type.startsWith('image/')) {
    return file;
  }

  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const {
    maxWidth,
    maxHeight,
    quality,
    maxSizeBytes,
    force,
    outputMimeType,
  } = mergedOptions;

  const requiresCompression = force || file.size > maxSizeBytes;
  let source: ImageBitmap | HTMLImageElement;

  try {
    source = await loadImageSource(file);
  } catch {
    return file;
  }

  const { width, height } = getSourceDimensions(source);
  if (!width || !height) {
    return file;
  }

  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  if (!requiresCompression && scale === 1) {
    if (isImageBitmap(source)) {
      source.close();
    }
    return file;
  }

  const canvas = drawImageToCanvas(source, targetWidth, targetHeight);
  const preferredMime =
    outputMimeType ??
    (file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg');

  const attemptBlob = async (mimeType: string, currentQuality: number) => {
    try {
      return await canvasToBlob(canvas, mimeType, currentQuality);
    } catch {
      if (mimeType !== 'image/jpeg') {
        return canvasToBlob(canvas, 'image/jpeg', currentQuality);
      }
      throw new Error('Failed to compress image');
    }
  };

  let currentQuality = quality;
  let compressedBlob = await attemptBlob(preferredMime, currentQuality);

  if (maxSizeBytes) {
    while (compressedBlob.size > maxSizeBytes && currentQuality > 0.45) {
      currentQuality = Math.max(0.45, currentQuality - 0.1);
      compressedBlob = await attemptBlob(preferredMime, currentQuality);
    }
  }

  if (compressedBlob.size >= file.size) {
    return file;
  }

  const newFile = new File([compressedBlob], renameFileByMime(file.name, compressedBlob.type), {
    type: compressedBlob.type,
    lastModified: Date.now(),
  });

  return newFile;
};
