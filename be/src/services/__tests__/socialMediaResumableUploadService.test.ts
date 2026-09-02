jest.mock('../googleDrive.js', () => ({
  getDriveAuthClient: jest.fn(),
  getDriveClient: jest.fn(),
}));
jest.mock('../socialMediaAssetStorageService.js', () => ({
  SocialMediaAssetStorageValidationError:
    class SocialMediaAssetStorageValidationError extends Error {},
  buildSocialMediaStoredFileName: jest.fn((name: string) => `stored-${name}`),
  ensureGoogleDriveChildFolder: jest.fn(),
  ensureSocialMediaProjectFolder: jest.fn(),
  sanitizeSocialMediaAssetOriginalName: jest.fn((name: string) => name.trim()),
}));

import { getDriveAuthClient, getDriveClient } from '../googleDrive';
import crypto from 'crypto';
import {
  ensureGoogleDriveChildFolder,
  ensureSocialMediaProjectFolder,
} from '../socialMediaAssetStorageService';
import {
  finalizeSocialMediaResumableUpload,
  initiateSocialMediaResumableUpload,
  SOCIAL_MEDIA_RESUMABLE_CHUNK_SIZE_BYTES,
} from '../socialMediaResumableUploadService';

const request = jest.fn();
const filesGet = jest.fn();

const common = {
  contentId: 41,
  title: 'Krakow nightlife',
  folderId: 'project-folder',
  kind: 'raw_material' as const,
  originalName: 'raw clip.mov',
  mimeType: 'video/quicktime',
  sizeBytes: 12_345_678,
};
const metadataHash = crypto.createHash('sha256').update(JSON.stringify([
  String(common.contentId),
  common.kind,
  common.originalName,
  common.mimeType,
  String(common.sizeBytes),
])).digest('hex');

describe('Social Media resumable Drive uploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getDriveAuthClient as jest.Mock).mockReturnValue({ request });
    (getDriveClient as jest.Mock).mockResolvedValue({ files: { get: filesGet } });
    (ensureSocialMediaProjectFolder as jest.Mock).mockResolvedValue({
      folderId: 'project-folder',
      driveProjectUrl: 'https://drive.google.com/drive/folders/project-folder',
    });
    (ensureGoogleDriveChildFolder as jest.Mock).mockResolvedValue({
      id: 'raw-folder',
      webViewLink: null,
    });
  });

  it('creates a private, chunked Drive session in the correct asset folder', async () => {
    request.mockResolvedValue({
      headers: { location: 'https://www.googleapis.com/upload/drive/session-1' },
    });

    const result = await initiateSocialMediaResumableUpload(common);

    expect(result).toEqual({
      uploadUrl: 'https://www.googleapis.com/upload/drive/session-1',
      uploadToken: expect.any(String),
      chunkSizeBytes: SOCIAL_MEDIA_RESUMABLE_CHUNK_SIZE_BYTES,
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      params: expect.objectContaining({ uploadType: 'resumable' }),
      headers: expect.objectContaining({
        'X-Upload-Content-Type': 'video/quicktime',
        'X-Upload-Content-Length': String(common.sizeBytes),
      }),
      data: expect.objectContaining({
        name: 'stored-raw clip.mov',
        parents: ['raw-folder'],
        appProperties: expect.objectContaining({
          omniSocialContentId: '41',
          omniSocialAssetKind: 'raw_material',
          omniSocialUploadToken: expect.any(String),
          omniSocialMetadataHash: metadataHash,
        }),
      }),
    }));
  });

  it('accepts only a completed file carrying the matching private receipt', async () => {
    filesGet.mockResolvedValue({
      data: {
        id: 'drive-file-1',
        mimeType: common.mimeType,
        size: String(common.sizeBytes),
        parents: ['raw-folder'],
        appProperties: {
          omniSocialContentId: '41',
          omniSocialAssetKind: 'raw_material',
          omniSocialUploadToken: 'receipt-1',
          omniSocialMetadataHash: metadataHash,
        },
        webViewLink: 'https://drive.google.com/file/d/drive-file-1/view',
        trashed: false,
      },
    });

    await expect(finalizeSocialMediaResumableUpload({
      ...common,
      driveFileId: 'drive-file-1',
      uploadToken: 'receipt-1',
    })).resolves.toEqual({
      driveFileId: 'drive-file-1',
      webViewUrl: 'https://drive.google.com/file/d/drive-file-1/view',
      originalName: common.originalName,
      mimeType: common.mimeType,
      sizeBytes: common.sizeBytes,
    });
  });

  it('rejects a Drive file whose private upload receipt was tampered with', async () => {
    filesGet.mockResolvedValue({
      data: {
        id: 'drive-file-1',
        mimeType: common.mimeType,
        size: String(common.sizeBytes),
        parents: ['raw-folder'],
        appProperties: {
          omniSocialContentId: '41',
          omniSocialAssetKind: 'raw_material',
          omniSocialUploadToken: 'different-receipt',
          omniSocialMetadataHash: metadataHash,
        },
        trashed: false,
      },
    });

    await expect(finalizeSocialMediaResumableUpload({
      ...common,
      driveFileId: 'drive-file-1',
      uploadToken: 'receipt-1',
    })).rejects.toThrow('does not match this Social Media upload session');
  });
});
