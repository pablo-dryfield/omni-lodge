jest.mock('../googleDrive.js', () => ({
  ensureFolderPath: jest.fn(),
  getDriveClient: jest.fn(),
  uploadBuffer: jest.fn(),
}));

import { ensureFolderPath, getDriveClient, uploadBuffer } from '../googleDrive';
import {
  openSocialMediaThumbnailStream,
  storeSocialMediaThumbnail,
} from '../socialMediaThumbnailStorageService';

const mockEnsureFolderPath = ensureFolderPath as jest.Mock;
const mockUploadBuffer = uploadBuffer as jest.Mock;
const mockGetDriveClient = getDriveClient as jest.Mock;

describe('Social Media thumbnail storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnsureFolderPath.mockResolvedValue({ id: 'folder-1', path: ['Social Media'] });
    mockUploadBuffer.mockResolvedValue({ id: 'drive-image-1', webViewLink: null, webContentLink: null });
  });

  it('stores supported images in the content folder and returns a stable authenticated URL', async () => {
    const result = await storeSocialMediaThumbnail({
      contentId: 41,
      title: 'A night in Krakow',
      originalName: 'cover.webp',
      mimeType: 'image/webp',
      data: Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBP', 'binary'),
    });

    expect(mockEnsureFolderPath).toHaveBeenCalledWith(
      'Social Media/41 - A night in Krakow/Thumbnails',
    );
    expect(mockUploadBuffer).toHaveBeenCalledWith(expect.objectContaining({
      mimeType: 'image/webp',
      parents: ['folder-1'],
    }));
    expect(result).toEqual({
      driveFileId: 'drive-image-1',
      thumbnailUrl: '/api/social-media/content/41/thumbnail',
      originalName: 'cover.webp',
      mimeType: 'image/webp',
    });

    const jpegResult = await storeSocialMediaThumbnail({
      contentId: 42,
      title: 'Another night in Krakow',
      originalName: 'cover.jpg',
      mimeType: 'image/jpg',
      data: Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
    });
    expect(mockUploadBuffer).toHaveBeenLastCalledWith(expect.objectContaining({
      mimeType: 'image/jpeg',
    }));
    expect(jpegResult.mimeType).toBe('image/jpeg');
  });

  it('rejects unsupported or oversized thumbnail files before contacting Drive', async () => {
    await expect(storeSocialMediaThumbnail({
      contentId: 41,
      title: 'A night in Krakow',
      originalName: 'cover.svg',
      mimeType: 'image/svg+xml',
      data: Buffer.from('<svg/>'),
    })).rejects.toThrow('Only JPG, PNG, WEBP, and GIF thumbnails are supported.');

    await expect(storeSocialMediaThumbnail({
      contentId: 41,
      title: 'A night in Krakow',
      originalName: 'cover.png',
      mimeType: 'image/png',
      data: Buffer.alloc(5 * 1024 * 1024 + 1),
    })).rejects.toThrow('Thumbnail files cannot be larger than 5 MB.');

    await expect(storeSocialMediaThumbnail({
      contentId: 41,
      title: 'A night in Krakow',
      originalName: 'cover.webp',
      mimeType: 'image/webp',
      data: Buffer.from('not really an image'),
    })).rejects.toThrow('The thumbnail contents do not match the selected image format.');

    expect(mockUploadBuffer).not.toHaveBeenCalled();
  });

  it('rejects unsafe Drive metadata before requesting file contents', async () => {
    const get = jest.fn().mockResolvedValue({ data: { mimeType: 'text/html' } });
    mockGetDriveClient.mockResolvedValue({ files: { get } });

    await expect(openSocialMediaThumbnailStream('drive-image-1')).rejects.toThrow(
      'Stored thumbnail has an unsupported image format.',
    );
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'drive-image-1',
      fields: 'mimeType',
    }));
  });
});
