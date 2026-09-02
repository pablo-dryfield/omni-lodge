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
  checkSocialMediaProjectFolder,
  deleteSocialMediaAsset,
  ensureSocialMediaProjectFolder,
  SocialMediaProjectFolderCheckUnavailableError,
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

  it('reports an active persisted project folder with a canonical URL', async () => {
    const drive = makeDrive();
    drive.files.get.mockResolvedValue({
      data: {
        id: 'project-folder-7',
        mimeType: 'application/vnd.google-apps.folder',
        trashed: false,
        webViewLink: null,
      },
    });
    mockGetDriveClient.mockResolvedValue(drive);

    await expect(checkSocialMediaProjectFolder('project-folder-7')).resolves.toEqual({
      available: true,
      folderId: 'project-folder-7',
      driveProjectUrl: 'https://drive.google.com/drive/folders/project-folder-7',
    });
  });

  it.each([
    ['a 404', () => Promise.reject({ response: { status: 404 } })],
    ['a trashed folder', () => Promise.resolve({
      data: {
        id: 'project-folder-7',
        mimeType: 'application/vnd.google-apps.folder',
        trashed: true,
      },
    })],
    ['a non-folder resource', () => Promise.resolve({
      data: {
        id: 'project-folder-7',
        mimeType: 'video/mp4',
        trashed: false,
      },
    })],
  ])('reports a definitively missing project folder for %s', async (_label, driveResult) => {
    const drive = makeDrive();
    drive.files.get.mockImplementation(driveResult);
    mockGetDriveClient.mockResolvedValue(drive);

    await expect(checkSocialMediaProjectFolder('project-folder-7')).resolves.toEqual({
      available: false,
    });
  });

  it.each([
    ['authentication', { response: { status: 401 } }],
    ['authorization', { response: { status: 403 } }],
    ['server', { response: { status: 503 } }],
    ['network', new Error('socket closed')],
  ])('keeps %s Drive failures distinct from folder deletion', async (_label, driveError) => {
    const drive = makeDrive();
    drive.files.get.mockRejectedValue(driveError);
    mockGetDriveClient.mockResolvedValue(drive);

    await expect(checkSocialMediaProjectFolder('project-folder-7')).rejects.toBeInstanceOf(
      SocialMediaProjectFolderCheckUnavailableError,
    );
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

  it('creates creator and project folders under the dedicated Social Media root', async () => {
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
    drive.files.create
      .mockResolvedValueOnce({ data: { id: 'creator-folder-23', webViewLink: null } })
      .mockResolvedValueOnce({ data: { id: 'project-folder-8', webViewLink: null } });
    mockGetDriveClient.mockResolvedValue(drive);

    const result = await ensureSocialMediaProjectFolder({
      contentId: 8,
      title: 'Krakow / After Dark',
      creatorUserId: 23,
      creatorFullName: 'Maia Wagemann',
    });

    expect(drive.files.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      requestBody: expect.objectContaining({
        name: 'Maia Wagemann - Social Media',
        parents: ['social-root'],
        appProperties: { omniLodgeSocialMediaCreatorId: '23' },
      }),
    }));
    expect(drive.files.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      requestBody: expect.objectContaining({
        name: 'Krakow After Dark',
        parents: ['creator-folder-23'],
        appProperties: { omniLodgeSocialMediaContentId: '8' },
      }),
    }));
    expect(drive.files.list.mock.calls[0][0].q).toContain(
      "appProperties has { key='omniLodgeSocialMediaCreatorId' and value='23' }",
    );
    expect(drive.files.list.mock.calls[1][0].q).toContain(
      "appProperties has { key='omniLodgeSocialMediaContentId' and value='8' }",
    );
    expect(result.driveProjectUrl).toBe(
      'https://drive.google.com/drive/folders/project-folder-8',
    );
  });

  it('reuses the creator folder by user ID and separates duplicate idea titles by content ID', async () => {
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
    drive.files.list
      .mockResolvedValueOnce({ data: { files: [{ id: 'creator-folder-23' }] } })
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'creator-folder-23' }] } })
      .mockResolvedValueOnce({ data: { files: [] } });
    drive.files.create
      .mockResolvedValueOnce({ data: { id: 'project-folder-8', webViewLink: null } })
      .mockResolvedValueOnce({ data: { id: 'project-folder-9', webViewLink: null } });
    mockGetDriveClient.mockResolvedValue(drive);

    await ensureSocialMediaProjectFolder({
      contentId: 8,
      title: 'Same idea',
      creatorUserId: 23,
      creatorFullName: 'Maia Wagemann',
    });
    await ensureSocialMediaProjectFolder({
      contentId: 9,
      title: 'Same idea',
      creatorUserId: 23,
      creatorFullName: 'Maia Wagemann',
    });

    expect(drive.files.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      requestBody: expect.objectContaining({
        name: 'Same idea',
        parents: ['creator-folder-23'],
        appProperties: { omniLodgeSocialMediaContentId: '8' },
      }),
    }));
    expect(drive.files.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      requestBody: expect.objectContaining({
        name: 'Same idea',
        parents: ['creator-folder-23'],
        appProperties: { omniLodgeSocialMediaContentId: '9' },
      }),
    }));
  });

  it('uses a deterministic creator-folder fallback when the creator record is unavailable', async () => {
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
    drive.files.create
      .mockResolvedValueOnce({ data: { id: 'unknown-creator-folder', webViewLink: null } })
      .mockResolvedValueOnce({ data: { id: 'project-folder-12', webViewLink: null } });
    mockGetDriveClient.mockResolvedValue(drive);

    await ensureSocialMediaProjectFolder({ contentId: 12, title: 'Fallback idea' });

    expect(drive.files.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      requestBody: expect.objectContaining({
        name: 'Unknown Creator 12 - Social Media',
        parents: ['social-root'],
        appProperties: { omniLodgeSocialMediaCreatorId: 'content-12' },
      }),
    }));
  });
});
