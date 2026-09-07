import sharp from 'sharp';
import { normalizeCleaningPhoto } from '../cleaningPhotoValidationService.js';
describe('untrusted cleaning image normalization', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('fully decodes and normalizes %s to a metadata-free JPEG', async (format) => {
    const input = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#123456' } }).toFormat(format).toBuffer();
    const photo = await normalizeCleaningPhoto(input);
    expect(photo).toMatchObject({ mimeType: 'image/jpeg', width: 20, height: 10, fileName: 'cleaning-photo.jpg' });
    expect(photo.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const metadata = await sharp(photo.data).metadata();
    expect(metadata.format).toBe('jpeg'); expect(metadata.exif).toBeUndefined();
  });
  it('rejects empty, SVG, renamed non-images, oversized buffers and truncated pixel data', async () => {
    for (const buffer of [Buffer.alloc(0), Buffer.from('<svg><script>alert(1)</script></svg>'), Buffer.from('not a photo'), Buffer.from([0xff, 0xd8, 0xff, 1, 2])]) {
      await expect(normalizeCleaningPhoto(buffer)).rejects.toMatchObject({ status: 400 });
    }
    await expect(normalizeCleaningPhoto(Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 413 });
  });
});
