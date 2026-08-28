import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getConfigValue } from './configService.js';

const ALLOWED_IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

type StorefrontMediaConfig = {
  bucket: string;
  publicBaseUrl: string;
  client: S3Client;
};

const readRequiredString = (key: string): string => {
  const value = getConfigValue(key);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Storefront media is not configured. Set ${key} in the control panel.`);
  }
  return value.trim();
};

const getMediaConfig = (): StorefrontMediaConfig => {
  const accountId = readRequiredString('STOREFRONT_MEDIA_R2_ACCOUNT_ID');
  const accessKeyId = readRequiredString('STOREFRONT_MEDIA_R2_ACCESS_KEY_ID');
  const secretAccessKey = readRequiredString('STOREFRONT_MEDIA_R2_SECRET_ACCESS_KEY');
  const bucket = readRequiredString('STOREFRONT_MEDIA_R2_BUCKET');
  const publicBaseUrl = readRequiredString('STOREFRONT_MEDIA_PUBLIC_BASE_URL').replace(/\/+$/, '');

  return {
    bucket,
    publicBaseUrl,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
};

const normalizeProductName = (name: string): string => {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'product';
};

const keyFromPublicUrl = (url: string, publicBaseUrl: string): string => {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(`${publicBaseUrl}/`);
  } catch {
    throw new Error('Invalid storefront media URL.');
  }

  if (parsed.origin !== base.origin || !parsed.pathname.startsWith(base.pathname)) {
    throw new Error('Only media from the configured storefront bucket can be removed.');
  }

  const key = decodeURIComponent(parsed.pathname.slice(base.pathname.length)).replace(/^\/+/, '');
  if (!key) throw new Error('Invalid storefront media object key.');
  return key;
};

export const uploadProductMedia = async (params: {
  productId: number;
  productName: string;
  file: Express.Multer.File;
}): Promise<{ url: string; alt: string; order: number }> => {
  const extension = ALLOWED_IMAGE_TYPES.get(params.file.mimetype);
  if (!extension) {
    throw new Error('Use a JPEG, PNG, WebP, or GIF image.');
  }

  const { bucket, publicBaseUrl, client } = getMediaConfig();
  const key = `products/${params.productId}/${normalizeProductName(params.productName)}-${randomUUID()}.${extension}`;

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: params.file.buffer,
    ContentType: params.file.mimetype,
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return {
    url: `${publicBaseUrl}/${key}`,
    alt: params.productName.trim(),
    order: 1,
  };
};

export const deleteProductMedia = async (params: {
  productId: number;
  url: string;
}): Promise<void> => {
  const { bucket, publicBaseUrl, client } = getMediaConfig();
  const key = keyFromPublicUrl(params.url, publicBaseUrl);
  if (!key.startsWith(`products/${params.productId}/`)) {
    throw new Error('This image does not belong to the selected product.');
  }
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};
