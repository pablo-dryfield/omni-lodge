import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getConfigValue } from '../configService';
import { deleteProductMedia, uploadProductMedia } from '../storefrontMediaService';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input) => ({ operation: 'put', input })),
  DeleteObjectCommand: jest.fn((input) => ({ operation: 'delete', input })),
}));

jest.mock('../configService.js', () => ({ getConfigValue: jest.fn() }));

const mockedGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;

const config: Record<string, string> = {
  STOREFRONT_MEDIA_R2_ACCOUNT_ID: 'account-id',
  STOREFRONT_MEDIA_R2_ACCESS_KEY_ID: 'access-key',
  STOREFRONT_MEDIA_R2_SECRET_ACCESS_KEY: 'secret-key',
  STOREFRONT_MEDIA_R2_BUCKET: 'ktk-product-media',
  STOREFRONT_MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
};

describe('storefrontMediaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockedGetConfigValue.mockImplementation((key) => config[key] ?? null);
  });

  it('uploads immutable product media under a product-specific key', async () => {
    const image = await uploadProductMedia({
      productId: 28,
      productName: 'Kraków Pub Crawl',
      file: {
        buffer: Buffer.from('image'),
        mimetype: 'image/webp',
      } as Express.Multer.File,
    });

    expect(image.url).toMatch(/^https:\/\/media\.example\.com\/products\/28\/krakow-pub-crawl-[\w-]+\.webp$/);
    expect(image.alt).toBe('Kraków Pub Crawl');
    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({
      region: 'auto',
      endpoint: 'https://account-id.r2.cloudflarestorage.com',
    }));
    expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
      Bucket: 'ktk-product-media',
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported files before contacting R2', async () => {
    await expect(uploadProductMedia({
      productId: 28,
      productName: 'Pub Crawl',
      file: { buffer: Buffer.from('file'), mimetype: 'application/pdf' } as Express.Multer.File,
    })).rejects.toThrow('Use a JPEG, PNG, WebP, or GIF image.');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('only deletes media belonging to the selected product', async () => {
    await expect(deleteProductMedia({
      productId: 28,
      url: 'https://media.example.com/products/29/other.webp',
    })).rejects.toThrow('This image does not belong to the selected product.');
    expect(mockSend).not.toHaveBeenCalled();

    await deleteProductMedia({
      productId: 28,
      url: 'https://media.example.com/products/28/photo.webp',
    });
    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: 'ktk-product-media',
      Key: 'products/28/photo.webp',
    });
  });
});
