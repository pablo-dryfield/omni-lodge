jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  createReadStream: jest.fn(() => ({ stream: true })),
  promises: {
    ...jest.requireActual('fs').promises,
    stat: jest.fn(),
  },
}));

jest.mock('../configService.js', () => ({
  getConfigValue: jest.fn(),
}));

jest.mock('../googleDrive.js', () => ({
  getDriveClient: jest.fn(),
}));

jest.mock('../../models/SocialMediaContentAsset.js', () => ({
  SOCIAL_MEDIA_CONTENT_ASSET_KINDS: ['final_video', 'raw_material', 'project_file'],
}));

import { createReadStream, promises as fs } from 'fs';
import { getConfigValue } from '../configService';
import { getDriveClient } from '../googleDrive';
import {
  deleteSocialMediaAsset,
  ensureSocialMediaProjectFolder,
  storeSocialMediaAsset,
} from '../socialMediaAssetStorageService';

const mockCreateReadStream = createReadStream as jest.Mock;
const mockStat = fs.stat as jest.Mock;
const mockGetConfigValue = getConfigValue as jest.Mock;
const mockGetDriveClient = getDriveClient as jest.Mock;

const makeDrive = () => ({
  files: {
    get: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
});

describe('Social Media production asset storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStat.mockResolvedValue({ isFile: () => true, size: 4096 });
  });

  it('reuses the persisted private project folder ID', async () => {
    const drive = makeDrive();
    drive.files.get.mockResolvedValue({
      data: {
        id: 'project-folder-7',
        mimeType: 'application/vnd.google-apps.folder',
        trashed: false,
        webViewLink: 'https://drive.google.com/project-7',
      },
    });
    mockGetDriveClient.mockResolvedValue(drive);

    await expect(ensureSocialMediaProjectFolder({
      contentId: 7,
      title: 'Night out',
      existingFolderId: 'project-folder-7',
    })).resolves.toEqual({
      folderId: 'project-folder-7',
      driveProjectUrl: 'https://drive.google.com/project-7',
    });
    expect(drive.files.list).not.toHaveBeenCalled();
    expect(drive.files.create).not.toHaveBeenCalled();
  });

  it('streams disk-backed uploads into the folder for their asset kind', async () => {
    const drive = makeDrive();
    drive.files.get.mockResolvedValue({
      data: {
        id: 'project-folder-7',
        mimeType: 'application/vnd.google-apps.folder',
        trashed: false,
        webViewLink: null,
      },
    });
    drive.files.list.mockResolvedValue({
      data: { files: [{ id: 'raw-folder', webViewLink: null }] },
    });
    drive.files.create.mockResolvedValue({
      data: { id: 'drive-asset-1', webViewLink: null },
    });
    mockGetDriveClient.mockResolvedValue(drive);

    const result = await storeSocialMediaAsset({
      contentId: 7,
      title: 'Night out',
      folderId: 'project-folder-7',
      kind: 'raw_material',
      tempPath: 'C:/temp/social-upload-1',
      originalName: 'Raw clip 01.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 4096,
    });

    expect(mockCreateReadStream).toHaveBeenCalledWith('C:/temp/social-upload-1');
    expect(drive.files.list).toHaveBeenCalledWith(expect.objectContaining({
      q: expect.stringContaining("name = 'Raw Material'"),
    }));
    expect(drive.files.create).toHaveBeenCalledWith(expect.objectContaining({
      media: expect.objectContaining({
        mimeType: 'video/quicktime',
        body: { stream: true },
      }),
      requestBody: expect.objectContaining({ parents: ['raw-folder'] }),
    }));
    expect(result).toEqual(expect.objectContaining({
      driveFileId: 'drive-asset-1',
      webViewUrl: 'https://drive.google.com/file/d/drive-asset-1/view',
      originalName: 'Raw clip 01.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 4096,
    }));
  });

  it('rejects a mismatched disk file size before uploading', async () => {
    const drive = makeDrive();
    mockGetDriveClient.mockResolvedValue(drive);

    await expect(storeSocialMediaAsset({
      contentId: 7,
      title: 'Night out',
      folderId: 'project-folder-7',
      kind: 'project_file',
      tempPath: 'C:/temp/social-upload-1',
      originalName: 'edit.zip',
      mimeType: 'application/zip',
      sizeBytes: 4095,
    })).rejects.toThrow('size does not match');
    expect(drive.files.create).not.toHaveBeenCalled();
  });

  it('treats an already-missing Drive asset as deleted', async () => {
    const drive = makeDrive();
    drive.files.delete.mockRejectedValue({ response: { status: 404 } });
    mockGetDriveClient.mockResolvedValue(drive);

    await expect(deleteSocialMediaAsset('missing-file')).resolves.toBeUndefined();
  });

  it('uses the dedicated social media root when creating a project', async () => {
    const drive = makeDrive();
    mockGetConfigValue.mockImplementation((key: string) =>
      key === 'GOOGLE_DRIVE_SOCIAL_MEDIA_PARENT_ID' ? 'social-root' : null,
    );
    drive.files.get.mockResolvedValue({
      data: {
        id: 'social-root',
        mimeType: 'application/vnd.google-apps.folder',
        trashed: false,
        webViewLink: null,
      },
    });
    drive.files.list.mockResolvedValue({ data: { files: [] } });
    drive.files.create.mockResolvedValue({
      data: { id: 'project-folder-8', webViewLink: null },
    });
    mockGetDriveClient.mockResolvedValue(drive);

    const result = await ensureSocialMediaProjectFolder({
      contentId: 8,
      title: 'Krakow / After Dark',
    });

    expect(drive.files.create).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({
        name: '8 - Krakow After Dark',
        parents: ['social-root'],
      }),
    }));
    expect(result.driveProjectUrl).toBe(
      'https://drive.google.com/drive/folders/project-folder-8',
    );
  });
});
