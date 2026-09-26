import { prepareCerebroImageUpload } from './cerebroImageUpload';
import { compressImageFile } from './imageCompression';

jest.mock('./imageCompression', () => ({
  compressImageFile: jest.fn(),
}));

const mockedCompressImageFile = compressImageFile as jest.MockedFunction<typeof compressImageFile>;

describe('prepareCerebroImageUpload', () => {
  beforeEach(() => {
    mockedCompressImageFile.mockReset();
  });

  it('recognizes an iPhone HEIC photo with no browser-provided MIME type and converts it', async () => {
    const iphonePhoto = new File(['heic'], 'IMG_0042.HEIC', { type: '' });
    const jpeg = new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' });
    mockedCompressImageFile.mockResolvedValue(jpeg);

    await expect(prepareCerebroImageUpload(iphonePhoto)).resolves.toBe(jpeg);
    expect(mockedCompressImageFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'IMG_0042.HEIC', type: 'image/heic' }),
      expect.objectContaining({ maxWidth: 2400, maxHeight: 2400, outputMimeType: 'image/jpeg' }),
    );
  });

  it('prepares regular camera pictures for a size-safe upload', async () => {
    const photo = new File(['photo'], 'camera.jpg', { type: 'image/jpeg' });
    const compressed = new File(['small'], 'camera.jpg', { type: 'image/jpeg' });
    mockedCompressImageFile.mockResolvedValue(compressed);

    await expect(prepareCerebroImageUpload(photo)).resolves.toBe(compressed);
    expect(mockedCompressImageFile).toHaveBeenCalledWith(
      photo,
      expect.objectContaining({ maxSizeBytes: 8 * 1024 * 1024 }),
    );
  });

  it('keeps animated GIFs unchanged', async () => {
    const gif = new File(['gif'], 'animation.gif', { type: 'image/gif' });

    await expect(prepareCerebroImageUpload(gif)).resolves.toBe(gif);
    expect(mockedCompressImageFile).not.toHaveBeenCalled();
  });

  it('rejects a HEIC photo when conversion is unavailable', async () => {
    const iphonePhoto = new File(['heic'], 'IMG_0042.heic', { type: 'image/heic' });
    mockedCompressImageFile.mockResolvedValue(iphonePhoto);

    await expect(prepareCerebroImageUpload(iphonePhoto)).rejects.toThrow(
      'could not be converted',
    );
  });

  it('rejects non-image files before upload', async () => {
    const textFile = new File(['notes'], 'notes.txt', { type: 'text/plain' });

    await expect(prepareCerebroImageUpload(textFile)).rejects.toThrow('Choose a JPG');
    expect(mockedCompressImageFile).not.toHaveBeenCalled();
  });
});
