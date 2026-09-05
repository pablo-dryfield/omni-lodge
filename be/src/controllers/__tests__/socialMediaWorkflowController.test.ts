jest.mock('../../models/SocialMediaContent.js', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
    sequelize: {
      transaction: jest.fn(),
    },
  },
}));
jest.mock('../../models/SocialMediaContentAsset.js', () => ({
  __esModule: true,
  SOCIAL_MEDIA_CONTENT_ASSET_KINDS: [
    'final_video',
    'raw_material',
    'project_file',
  ],
  default: {
    create: jest.fn(),
    destroy: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
  },
}));
jest.mock('../socialMediaContentController.js', () => ({
  loadSocialMediaContent: jest.fn(),
  serializeSocialMediaContent: jest.fn(),
}));
jest.mock('../../services/socialMediaAssetStorageService.js', () => ({
  SocialMediaAssetStorageValidationError:
    class SocialMediaAssetStorageValidationError extends Error {},
  SocialMediaProjectFolderCheckUnavailableError:
    class SocialMediaProjectFolderCheckUnavailableError extends Error {},
  checkSocialMediaProjectFolder: jest.fn(),
  deleteSocialMediaAsset: jest.fn(),
  ensureSocialMediaProjectFolder: jest.fn(),
  storeSocialMediaAsset: jest.fn(),
}));
jest.mock('../../services/socialMediaPublishTaskService.js', () => ({
  SocialMediaPublishTaskConflictError:
    class SocialMediaPublishTaskConflictError extends Error {},
  completeTaskForSocialMediaPublication: jest.fn(),
  syncPublishedSocialMediaTaskEvidence: jest.fn(),
}));
jest.mock('../../services/socialMediaResumableUploadService.js', () => ({
  SocialMediaResumableUploadPendingError:
    class SocialMediaResumableUploadPendingError extends Error {},
  findRecoverableSocialMediaResumableUploads: jest.fn(),
  finalizeSocialMediaResumableUpload: jest.fn(),
  initiateSocialMediaResumableUpload: jest.fn(),
  resolveTrustedSocialMediaUploadOrigin: jest.fn(
    (origin: string | undefined, referer: string | undefined) => {
      const candidate = origin ?? referer ?? 'https://omni-lodge.com';
      return new URL(candidate).origin;
    },
  ),
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn() },
}));

import type { Response } from 'express';
import { UniqueConstraintError } from 'sequelize';
import UserModelStub from '../../__mocks__/sequelizeModelStub';
import SocialMediaContent from '../../models/SocialMediaContent';
import SocialMediaContentAsset from '../../models/SocialMediaContentAsset';
import {
  checkSocialMediaProjectFolder,
  deleteSocialMediaAsset,
  ensureSocialMediaProjectFolder,
  SocialMediaAssetStorageValidationError,
  SocialMediaProjectFolderCheckUnavailableError,
  storeSocialMediaAsset,
} from '../../services/socialMediaAssetStorageService';
import {
  completeTaskForSocialMediaPublication,
  syncPublishedSocialMediaTaskEvidence,
} from '../../services/socialMediaPublishTaskService';
import {
  findRecoverableSocialMediaResumableUploads,
  finalizeSocialMediaResumableUpload,
  initiateSocialMediaResumableUpload,
  resolveTrustedSocialMediaUploadOrigin,
  SocialMediaResumableUploadPendingError,
} from '../../services/socialMediaResumableUploadService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import {
  loadSocialMediaContent,
  serializeSocialMediaContent,
} from '../socialMediaContentController';
import {
  createSocialMediaProjectFolder,
  checkSocialMediaProjectFolderHealth,
  finalizeSocialMediaAssetUpload,
  initiateSocialMediaAssetUpload,
  markSocialMediaReady,
  planSocialMediaContent,
  publishSocialMediaContent,
  removeSocialMediaAsset,
  startSocialMediaProduction,
  updatePublishedSocialMediaLinks,
  uploadSocialMediaAsset,
} from '../socialMediaWorkflowController';

const mockFindByPk = SocialMediaContent.findByPk as jest.Mock;
const mockTransaction = SocialMediaContent.sequelize?.transaction as jest.Mock;
const mockFindAssets = SocialMediaContentAsset.findAll as jest.Mock;
const mockFindAsset = SocialMediaContentAsset.findOne as jest.Mock;
const mockCreateAsset = SocialMediaContentAsset.create as jest.Mock;
const mockDestroyAssets = SocialMediaContentAsset.destroy as jest.Mock;
const mockFindUserByPk = jest.fn();
(UserModelStub as unknown as { findByPk: jest.Mock }).findByPk = mockFindUserByPk;
const mockDeleteAssetFromDrive = deleteSocialMediaAsset as jest.Mock;
const mockCheckProjectFolder = checkSocialMediaProjectFolder as jest.Mock;
const mockEnsureProjectFolder = ensureSocialMediaProjectFolder as jest.Mock;
const mockStoreAsset = storeSocialMediaAsset as jest.Mock;
const mockCompleteTask = completeTaskForSocialMediaPublication as jest.Mock;
const mockSyncPublishedTaskEvidence = syncPublishedSocialMediaTaskEvidence as jest.Mock;
const mockInitiateUpload = initiateSocialMediaResumableUpload as jest.Mock;
const mockFindRecoverableUploads = findRecoverableSocialMediaResumableUploads as jest.Mock;
const mockFinalizeUpload = finalizeSocialMediaResumableUpload as jest.Mock;
const mockResolveUploadOrigin = resolveTrustedSocialMediaUploadOrigin as jest.Mock;
const mockLoadContent = loadSocialMediaContent as jest.Mock;
const mockSerializeContent = serializeSocialMediaContent as jest.Mock;

const transaction = {
  LOCK: { UPDATE: 'UPDATE', SHARE: 'SHARE' },
};

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & { status: jest.Mock; json: jest.Mock };
};

const buildContent = (overrides: Record<string, unknown> = {}) => {
  const content: Record<string, unknown> = {
    id: 41,
    title: 'Krakow nightlife in 15 seconds',
    idea: 'Cut from the square to the first bar and finish on the dance floor.',
    onVideoCaptions: 'POV: your first night in Krakow',
    platformCaption: 'One night. Four bars. A lot of new friends.',
    hashtags: ['krakow', 'nightlife'],
    targetPlatforms: ['instagram', 'tiktok'],
    status: 'idea',
    scheduledAt: null,
    productionStartedAt: null,
    readyAt: null,
    publishedAt: null,
    publishedBy: null,
    publishedTaskLogId: null,
    driveProjectFolderId: null,
    driveProjectUrl: null,
    platformLinks: {},
    thumbnailUrl: null,
    ...overrides,
  };
  content.update = jest.fn(async (values: Record<string, unknown>) => {
    Object.assign(content, values);
    return content;
  });
  return content;
};

describe('Social Media production workflow controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(transaction));
    mockCheckProjectFolder.mockResolvedValue({
      available: true,
      folderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindRecoverableUploads.mockResolvedValue([]);
    mockSerializeContent.mockImplementation((content: Record<string, unknown>) => ({
      id: content.id,
      status: content.status,
    }));
  });

  it('moves an idea to Planned with a date-only value', async () => {
    const content = buildContent();
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await planSocialMediaContent({
      params: { id: '41' },
      body: { scheduledDate: '2026-09-11' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFindByPk).toHaveBeenCalledWith(41, {
      transaction,
      lock: 'UPDATE',
    });
    expect(content.update).toHaveBeenCalledWith({
      status: 'planned',
      scheduledAt: '2026-09-11',
      updatedBy: 7,
    }, { transaction });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      item: { id: 41, status: 'planned' },
    });
  });

  it('treats an exact Plan retry as success', async () => {
    const content = buildContent({ status: 'planned', scheduledAt: '2026-09-11' });
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    const retryResponse = createResponse();

    await planSocialMediaContent({
      params: { id: '41' },
      body: { scheduledDate: '2026-09-11' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, retryResponse);

    expect(content.update).not.toHaveBeenCalled();
    expect(retryResponse.status).toHaveBeenCalledWith(200);
  });

  it.each(['planned', 'in_production', 'ready'] as const)(
    'updates the planned date without changing the %s stage',
    async (status) => {
      const content = buildContent({ status, scheduledAt: '2026-09-11' });
      mockFindByPk.mockResolvedValue(content);
      mockLoadContent.mockResolvedValue(content);
      const response = createResponse();

      await planSocialMediaContent({
        params: { id: '41' },
        body: { scheduledDate: '2026-09-12' },
        authContext: { id: 7 },
      } as unknown as AuthenticatedRequest, response);

      expect(content.update).toHaveBeenCalledWith({
        scheduledAt: '2026-09-12',
        updatedBy: 7,
      }, { transaction });
      expect(content.status).toBe(status);
      expect(response.status).toHaveBeenCalledWith(200);
    },
  );

  it('updates the planned date and linked task evidence for published content', async () => {
    const content = buildContent({
      status: 'published',
      scheduledAt: '2026-09-11',
      publishedTaskLogId: 88,
    });
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await planSocialMediaContent({
      params: { id: '41' },
      body: { scheduledDate: '2026-09-12' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(content.update).toHaveBeenCalledWith({
      scheduledAt: '2026-09-12',
      updatedBy: 7,
    }, { transaction });
    expect(mockSyncPublishedTaskEvidence).toHaveBeenCalledWith({
      content,
      actorId: 7,
      transaction,
    });
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('does not allow an archived item to change its planned date', async () => {
    const content = buildContent({ status: 'archived', scheduledAt: '2026-09-11' });
    mockFindByPk.mockResolvedValue(content);
    const response = createResponse();

    await planSocialMediaContent({
      params: { id: '41' },
      body: { scheduledDate: '2026-09-12' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(content.update).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(409);
  });

  it.each([
    '2026-09-11T08:30:00.000Z',
    '2026-02-30',
    '',
  ])('rejects a planned date that is not a real YYYY-MM-DD value: %s', async (scheduledDate) => {
    const response = createResponse();

    await planSocialMediaContent({
      params: { id: '41' },
      body: { scheduledDate },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ message: 'Choose a valid planned date.' });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('allows only Planned content to start production', async () => {
    const planned = buildContent({ status: 'planned' });
    mockFindByPk.mockResolvedValue(planned);
    mockLoadContent.mockResolvedValue(planned);
    const allowedResponse = createResponse();

    await startSocialMediaProduction({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, allowedResponse);

    expect(planned.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'in_production',
      productionStartedAt: expect.any(Date),
      updatedBy: 7,
    }), { transaction });
    expect(allowedResponse.status).toHaveBeenCalledWith(200);

    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(transaction));
    const idea = buildContent({ status: 'idea' });
    mockFindByPk.mockResolvedValue(idea);
    const forbiddenResponse = createResponse();

    await startSocialMediaProduction({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, forbiddenResponse);

    expect(forbiddenResponse.status).toHaveBeenCalledWith(409);
    expect(idea.update).not.toHaveBeenCalled();
  });

  it('treats an exact Start Production retry as success without changing its audit timestamp', async () => {
    const startedAt = new Date('2026-09-02T09:00:00.000Z');
    const content = buildContent({
      status: 'in_production',
      productionStartedAt: startedAt,
    });
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await startSocialMediaProduction({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(content.update).not.toHaveBeenCalled();
    expect(content.productionStartedAt).toBe(startedAt);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it.each(['in_production', 'ready'] as const)(
    'creates or repairs the Drive project folder for %s content while holding the row lock',
    async (status) => {
    const content = buildContent({
      status,
      ...(status === 'ready' ? {
        driveProjectFolderId: 'folder-1',
        driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
      } : {}),
    });
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    mockEnsureProjectFolder.mockResolvedValue({
      folderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    const response = createResponse();

    await createSocialMediaProjectFolder({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFindByPk).toHaveBeenCalledWith(41, {
      transaction,
      lock: 'UPDATE',
    });
    expect(mockEnsureProjectFolder).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 41,
      existingFolderId: status === 'ready' ? 'folder-1' : null,
    }));
    if (status === 'in_production') {
      expect(mockCheckProjectFolder).not.toHaveBeenCalled();
    }
    expect(content.update).toHaveBeenCalledWith(expect.objectContaining({
      driveProjectFolderId: 'folder-1',
    }), { transaction });
    expect(response.status).toHaveBeenCalledWith(200);
    },
  );

  it('passes a trusted referrer-derived origin when the request Origin header is absent', async () => {
    const content = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockInitiateUpload.mockResolvedValue({
      uploadUrl: 'https://www.googleapis.com/upload/drive/session-1',
      uploadToken: 'receipt-1',
      chunkSizeBytes: 8 * 1024 * 1024,
    });
    const getHeader = jest.fn((name: string) =>
      name === 'referer' ? 'https://omni-lodge.com/social-media' : undefined);
    const response = createResponse();

    await initiateSocialMediaAssetUpload({
      params: { id: '41' },
      body: {
        assetType: 'raw_material',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      authContext: { id: 7 },
      get: getHeader,
    } as unknown as AuthenticatedRequest, response);

    expect(mockResolveUploadOrigin).toHaveBeenCalledWith(
      undefined,
      'https://omni-lodge.com/social-media',
    );
    expect(mockInitiateUpload).toHaveBeenCalledWith(expect.any(Object), {
      browserOrigin: 'https://omni-lodge.com',
    });
  });

  it('registers an exact unregistered Drive orphan instead of creating a duplicate session', async () => {
    const content = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockFindRecoverableUploads.mockResolvedValue([{
      driveFileId: 'orphan-file-1',
      webViewUrl: 'https://drive.google.com/file/d/orphan-file-1/view',
      originalName: 'raw.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 1_000_000,
    }]);
    mockFindAsset.mockResolvedValue(null);
    mockCreateAsset.mockResolvedValue({ id: 91 });
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await initiateSocialMediaAssetUpload({
      params: { id: '41' },
      body: {
        assetType: 'raw_material',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockCreateAsset).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 41,
      driveFileId: 'orphan-file-1',
    }), { transaction });
    expect(mockInitiateUpload).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      item: { id: 41, status: 'in_production' },
      recoveredUpload: true,
    });
  });

  it('prefers an unregistered orphan when an older registered metadata match also exists', async () => {
    const content = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockFindRecoverableUploads.mockResolvedValue([
      {
        driveFileId: 'registered-file-1',
        webViewUrl: 'https://drive.google.com/file/d/registered-file-1/view',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      {
        driveFileId: 'orphan-file-2',
        webViewUrl: 'https://drive.google.com/file/d/orphan-file-2/view',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
    ]);
    mockFindAsset
      .mockResolvedValueOnce({
        id: 91,
        contentId: 41,
        driveFileId: 'registered-file-1',
        kind: 'raw_material',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      })
      .mockResolvedValueOnce(null);
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await initiateSocialMediaAssetUpload({
      params: { id: '41' },
      body: {
        assetType: 'raw_material',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockCreateAsset).toHaveBeenCalledWith(expect.objectContaining({
      driveFileId: 'orphan-file-2',
    }), { transaction });
    expect(mockInitiateUpload).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('treats a registered exact metadata match as an idempotent session-start retry', async () => {
    const content = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockFindRecoverableUploads.mockResolvedValue([{
      driveFileId: 'registered-file-1',
      webViewUrl: 'https://drive.google.com/file/d/registered-file-1/view',
      originalName: 'raw.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 1_000_000,
    }]);
    mockFindAsset.mockResolvedValue({
      id: 91,
      contentId: 41,
      driveFileId: 'registered-file-1',
      kind: 'raw_material',
      originalName: 'raw.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 1_000_000,
    });
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await initiateSocialMediaAssetUpload({
      params: { id: '41' },
      body: {
        assetType: 'raw_material',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockCreateAsset).not.toHaveBeenCalled();
    expect(mockInitiateUpload).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      item: { id: 41, status: 'in_production' },
      recoveredUpload: true,
    });
  });

  it('checks an active saved folder without changing the workflow stage', async () => {
    const content = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/old-folder-url',
    });
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await checkSocialMediaProjectFolderHealth({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockCheckProjectFolder).toHaveBeenCalledWith('folder-1');
    expect(content.update).toHaveBeenCalledWith({
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
      updatedBy: 7,
    }, { transaction });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      item: { id: 41, status: 'in_production' },
      folderAvailable: true,
      reset: false,
    });
  });

  it('does not reset newly started production before its first folder is created', async () => {
    const content = buildContent({
      status: 'in_production',
      scheduledAt: '2026-09-11',
      productionStartedAt: new Date('2026-09-02T09:00:00.000Z'),
      driveProjectFolderId: null,
      driveProjectUrl: null,
    });
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await checkSocialMediaProjectFolderHealth({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockCheckProjectFolder).not.toHaveBeenCalled();
    expect(mockDestroyAssets).not.toHaveBeenCalled();
    expect(content.update).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      item: { id: 41, status: 'in_production' },
      folderAvailable: false,
      reset: false,
    });
  });

  it.each(['planned', 'in_production', 'ready'] as const)(
    'atomically resets %s content when Drive confirms its saved folder is gone',
    async (status) => {
      const scheduledAt = '2026-09-11';
      const content = buildContent({
        status,
        scheduledAt,
        productionStartedAt: new Date('2026-09-02T09:00:00.000Z'),
        readyAt: new Date('2026-09-02T10:00:00.000Z'),
        driveProjectFolderId: 'deleted-folder',
        driveProjectUrl: 'https://drive.google.com/drive/folders/deleted-folder',
      });
      mockFindByPk.mockResolvedValue(content);
      mockLoadContent.mockResolvedValue(content);
      mockCheckProjectFolder.mockResolvedValue({ available: false });
      const response = createResponse();

      await checkSocialMediaProjectFolderHealth({
        params: { id: '41' },
        authContext: { id: 7 },
      } as unknown as AuthenticatedRequest, response);

      expect(mockDestroyAssets).toHaveBeenCalledWith({
        where: { contentId: 41 },
        transaction,
      });
      expect(content.update).toHaveBeenCalledWith({
        status: 'planned',
        driveProjectFolderId: null,
        driveProjectUrl: null,
        productionStartedAt: null,
        readyAt: null,
        updatedBy: 7,
      }, { transaction });
      expect(content.scheduledAt).toBe(scheduledAt);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({
        item: { id: 41, status: 'planned' },
        folderAvailable: false,
        reset: true,
      });
    },
  );

  it('does not roll back or clear published content whose folder is missing', async () => {
    const content = buildContent({
      status: 'published',
      driveProjectFolderId: 'deleted-folder',
      driveProjectUrl: 'https://drive.google.com/drive/folders/deleted-folder',
    });
    mockFindByPk.mockResolvedValue(content);
    mockCheckProjectFolder.mockResolvedValue({ available: false });
    const response = createResponse();

    await checkSocialMediaProjectFolderHealth({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockDestroyAssets).not.toHaveBeenCalled();
    expect(content.update).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      message: expect.stringContaining('Published content was not changed'),
    });
  });

  it('does not mistake an indeterminate Drive failure for deletion', async () => {
    const content = buildContent({
      status: 'ready',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockCheckProjectFolder.mockRejectedValue(
      new SocialMediaProjectFolderCheckUnavailableError('Drive check unavailable'),
    );
    const response = createResponse();

    await checkSocialMediaProjectFolderHealth({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockDestroyAssets).not.toHaveBeenCalled();
    expect(content.update).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({ message: 'Drive check unavailable' });
  });

  it('uses the idea creator full name when creating the project hierarchy', async () => {
    const content = buildContent({ status: 'in_production', createdBy: 23 });
    mockFindByPk.mockResolvedValue(content);
    mockFindUserByPk.mockResolvedValue({ firstName: 'Maia', lastName: 'Wagemann' });
    mockLoadContent.mockResolvedValue(content);
    mockEnsureProjectFolder.mockResolvedValue({
      folderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    const response = createResponse();

    await createSocialMediaProjectFolder({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFindUserByPk).toHaveBeenCalledWith(23, {
      attributes: ['firstName', 'lastName'],
      transaction,
    });
    expect(mockEnsureProjectFolder).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 41,
      creatorUserId: 23,
      creatorFullName: 'Maia Wagemann',
    }));
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it.each(['in_production', 'ready'] as const)(
    'serializes an asset upload for %s content and persists metadata in the same transaction',
    async (status) => {
    const content = buildContent({
      status,
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    mockFindAsset.mockResolvedValue(null);
    mockStoreAsset.mockResolvedValue({
      driveFileId: 'drive-final-1',
      webViewUrl: 'https://drive.google.com/file/d/drive-final-1/view',
      originalName: 'final.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 2048,
    });
    mockCreateAsset.mockResolvedValue({ id: 91 });
    const response = createResponse();

    await uploadSocialMediaAsset({
      params: { id: '41' },
      body: { assetType: 'final_video' },
      authContext: { id: 7 },
      file: {
        path: 'missing-test-upload.mp4',
        originalname: 'final.mp4',
        mimetype: 'video/mp4',
        size: 2048,
      },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFindByPk).toHaveBeenCalledWith(41, {
      transaction,
      lock: 'UPDATE',
    });
    expect(mockCreateAsset).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 41,
      kind: 'final_video',
      driveFileId: 'drive-final-1',
    }), { transaction });
    expect(content.update).toHaveBeenCalledWith({ updatedBy: 7 }, { transaction });
    expect(response.status).toHaveBeenCalledWith(200);
    },
  );

  it('maps the final-video unique index race to 409 and cleans up the Drive upload', async () => {
    const content = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockFindAsset.mockResolvedValue(null);
    mockStoreAsset.mockResolvedValue({
      driveFileId: 'drive-final-race',
      webViewUrl: 'https://drive.google.com/file/d/drive-final-race/view',
      originalName: 'final.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 2048,
    });
    mockCreateAsset.mockRejectedValue(Object.create(UniqueConstraintError.prototype));
    const response = createResponse();

    await uploadSocialMediaAsset({
      params: { id: '41' },
      body: { assetType: 'final_video' },
      authContext: { id: 7 },
      file: {
        path: 'missing-racing-upload.mp4',
        originalname: 'final.mp4',
        mimetype: 'video/mp4',
        size: 2048,
      },
    } as unknown as AuthenticatedRequest, response);

    expect(mockDeleteAssetFromDrive).toHaveBeenCalledWith('drive-final-race');
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      message: 'A final video is already uploaded. Remove it before uploading a replacement.',
    });
  });

  it('commits asset metadata removal before best-effort Drive cleanup', async () => {
    const content = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    const asset = {
      driveFileId: 'drive-raw-1',
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    mockFindByPk.mockResolvedValue(content);
    mockFindAsset.mockResolvedValue(asset);
    mockLoadContent.mockResolvedValue(content);
    mockDeleteAssetFromDrive.mockRejectedValue(new Error('Drive temporarily unavailable'));
    const response = createResponse();

    await removeSocialMediaAsset({
      params: { id: '41', assetId: '91' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(asset.destroy).toHaveBeenCalledWith({ transaction });
    expect(mockDeleteAssetFromDrive).toHaveBeenCalledWith('drive-raw-1');
    expect(asset.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteAssetFromDrive.mock.invocationCallOrder[0],
    );
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('returns Ready content to In Production when its last required asset is removed', async () => {
    const content = buildContent({
      status: 'ready',
      readyAt: new Date('2026-09-02T10:00:00.000Z'),
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    const asset = {
      kind: 'final_video',
      driveFileId: 'drive-final-1',
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    mockFindByPk.mockResolvedValue(content);
    mockFindAsset
      .mockResolvedValueOnce(asset)
      .mockResolvedValueOnce(null);
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await removeSocialMediaAsset({
      params: { id: '41', assetId: '91' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFindAsset).toHaveBeenNthCalledWith(2, {
      where: { contentId: 41, kind: 'final_video' },
      transaction,
    });
    expect(content.update).toHaveBeenCalledWith({
      status: 'in_production',
      readyAt: null,
      updatedBy: 7,
    }, { transaction });
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('keeps content Ready when another asset of the removed required kind remains', async () => {
    const readyAt = new Date('2026-09-02T10:00:00.000Z');
    const content = buildContent({
      status: 'ready',
      readyAt,
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    const asset = {
      kind: 'raw_material',
      driveFileId: 'drive-raw-1',
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    mockFindByPk.mockResolvedValue(content);
    mockFindAsset
      .mockResolvedValueOnce(asset)
      .mockResolvedValueOnce({ id: 92, kind: 'raw_material' });
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await removeSocialMediaAsset({
      params: { id: '41', assetId: '91' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(content.update).toHaveBeenCalledWith({ updatedBy: 7 }, { transaction });
    expect(content.status).toBe('ready');
    expect(content.readyAt).toBe(readyAt);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('keeps published production assets immutable', async () => {
    const content = buildContent({ status: 'published' });
    mockFindByPk.mockResolvedValue(content);
    const response = createResponse();

    await removeSocialMediaAsset({
      params: { id: '41', assetId: '91' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFindAsset).not.toHaveBeenCalled();
    expect(content.update).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(409);
  });

  it('never deletes the Drive file when metadata removal fails', async () => {
    const content = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    const asset = {
      driveFileId: 'drive-project-1',
      destroy: jest.fn().mockRejectedValue(new Error('DB write failed')),
    };
    mockFindByPk.mockResolvedValue(content);
    mockFindAsset.mockResolvedValue(asset);
    const response = createResponse();

    await removeSocialMediaAsset({
      params: { id: '41', assetId: '91' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockDeleteAssetFromDrive).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(500);
  });

  it('requires every production asset kind before moving to Ready', async () => {
    const incomplete = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(incomplete);
    mockFindAssets.mockResolvedValue([{ kind: 'final_video' }]);
    const incompleteResponse = createResponse();

    await markSocialMediaReady({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, incompleteResponse);

    expect(incompleteResponse.status).toHaveBeenCalledWith(400);
    expect(incompleteResponse.json).toHaveBeenCalledWith({
      message: 'Upload raw material, project file before marking this content ready.',
    });
    expect(incomplete.update).not.toHaveBeenCalled();

    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(transaction));
    mockSerializeContent.mockImplementation((content: Record<string, unknown>) => ({
      id: content.id,
      status: content.status,
    }));
    const complete = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(complete);
    mockFindAssets.mockResolvedValue([
      { kind: 'final_video' },
      { kind: 'raw_material' },
      { kind: 'project_file' },
    ]);
    mockLoadContent.mockResolvedValue(complete);
    const completeResponse = createResponse();

    await markSocialMediaReady({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, completeResponse);

    expect(complete.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ready',
      readyAt: expect.any(Date),
      updatedBy: 7,
    }), { transaction });
    expect(completeResponse.status).toHaveBeenCalledWith(200);
  });

  it.each(['in_production', 'ready'] as const)(
    'starts a resumable upload for a %s item with a Drive folder',
    async (status) => {
    const content = buildContent({
      status,
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockFindAsset.mockResolvedValue(null);
    mockInitiateUpload.mockResolvedValue({
      uploadUrl: 'https://www.googleapis.com/upload/drive/session-1',
      uploadToken: 'receipt-1',
      chunkSizeBytes: 8 * 1024 * 1024,
    });
    const response = createResponse();

    await initiateSocialMediaAssetUpload({
      params: { id: '41' },
      body: {
        assetType: 'raw_material',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockInitiateUpload).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 41,
      folderId: 'folder-1',
      kind: 'raw_material',
      sizeBytes: 1_000_000,
    }), { browserOrigin: 'https://omni-lodge.com' });
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ uploadToken: 'receipt-1' }));
    },
  );

  it.each(['in_production', 'ready'] as const)(
    'verifies and records a completed resumable upload for %s content inside the content lock',
    async (status) => {
    const content = buildContent({
      status,
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockFindAsset.mockResolvedValue(null);
    mockFinalizeUpload.mockResolvedValue({
      driveFileId: 'drive-file-1',
      webViewUrl: 'https://drive.google.com/file/d/drive-file-1/view',
      originalName: 'raw.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 1_000_000,
    });
    mockCreateAsset.mockResolvedValue({ id: 91 });
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await finalizeSocialMediaAssetUpload({
      params: { id: '41' },
      body: {
        assetType: 'raw_material',
        driveFileId: 'drive-file-1',
        uploadToken: 'receipt-1',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFinalizeUpload).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 41,
      driveFileId: 'drive-file-1',
      uploadToken: 'receipt-1',
    }));
    expect(mockCreateAsset).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 41,
      kind: 'raw_material',
      driveFileId: 'drive-file-1',
      uploadedBy: 7,
    }), { transaction });
    expect(response.status).toHaveBeenCalledWith(200);
    },
  );

  it('checks resumable completion idempotency inside the content lock before any cleanup', async () => {
    const content = buildContent({
      status: 'ready',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockFindAsset.mockResolvedValue({
      id: 91,
      contentId: 41,
      driveFileId: 'drive-file-1',
      kind: 'raw_material',
      originalName: 'raw.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 1_000_000,
    });
    mockFinalizeUpload.mockResolvedValue({
      driveFileId: 'drive-file-1',
      webViewUrl: 'https://drive.google.com/file/d/drive-file-1/view',
      originalName: 'raw.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 1_000_000,
    });
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await finalizeSocialMediaAssetUpload({
      params: { id: '41' },
      body: {
        assetType: 'raw_material',
        driveFileId: 'drive-file-1',
        uploadToken: 'receipt-1',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFindByPk).toHaveBeenCalledWith(41, { transaction, lock: 'UPDATE' });
    expect(mockFindAsset).toHaveBeenCalledWith({
      where: { driveFileId: 'drive-file-1' },
      transaction,
    });
    expect(mockFindByPk.mock.invocationCallOrder[0]).toBeLessThan(
      mockFindAsset.mock.invocationCallOrder[0],
    );
    expect(mockFinalizeUpload).toHaveBeenCalledWith(expect.objectContaining({
      driveFileId: 'drive-file-1',
      uploadToken: 'receipt-1',
    }));
    expect(mockCreateAsset).not.toHaveBeenCalled();
    expect(mockDeleteAssetFromDrive).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('finalizes by private token when Google accepted the file but no file ID was readable', async () => {
    const content = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockFindAsset.mockResolvedValue(null);
    mockFinalizeUpload.mockResolvedValue({
      driveFileId: 'recovered-drive-file',
      webViewUrl: 'https://drive.google.com/file/d/recovered-drive-file/view',
      originalName: 'raw.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 1_000_000,
    });
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await finalizeSocialMediaAssetUpload({
      params: { id: '41' },
      body: {
        assetType: 'raw_material',
        uploadToken: 'receipt-1',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFinalizeUpload).toHaveBeenCalledWith(expect.objectContaining({
      driveFileId: '',
      uploadToken: 'receipt-1',
    }));
    expect(mockFindAsset).toHaveBeenCalledWith({
      where: { driveFileId: 'recovered-drive-file' },
      transaction,
    });
    expect(mockCreateAsset).toHaveBeenCalledWith(expect.objectContaining({
      driveFileId: 'recovered-drive-file',
    }), { transaction });
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('returns a retryable conflict while the completed token is not visible in Drive', async () => {
    const content = buildContent({
      status: 'in_production',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockFinalizeUpload.mockRejectedValue(new SocialMediaResumableUploadPendingError(
      'Google Drive has not exposed the completed upload yet. Try again shortly.',
    ));
    const response = createResponse();

    await finalizeSocialMediaAssetUpload({
      params: { id: '41' },
      body: {
        assetType: 'raw_material',
        uploadToken: 'receipt-1',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });

  it('rejects an invalid receipt even when its Drive file ID is already registered', async () => {
    const content = buildContent({
      status: 'ready',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockFinalizeUpload.mockRejectedValue(new SocialMediaAssetStorageValidationError(
      'The completed Google Drive file does not match this Social Media upload session.',
    ));
    const response = createResponse();

    await finalizeSocialMediaAssetUpload({
      params: { id: '41' },
      body: {
        assetType: 'raw_material',
        driveFileId: 'drive-file-1',
        uploadToken: 'forged-receipt',
        originalName: 'raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 1_000_000,
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFindAsset).not.toHaveBeenCalled();
    expect(mockCreateAsset).not.toHaveBeenCalled();
    expect(mockDeleteAssetFromDrive).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('treats an exact Ready retry as success without revalidating or changing its timestamp', async () => {
    const readyAt = new Date('2026-09-02T10:00:00.000Z');
    const content = buildContent({
      status: 'ready',
      readyAt,
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await markSocialMediaReady({
      params: { id: '41' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockFindAssets).not.toHaveBeenCalled();
    expect(content.update).not.toHaveBeenCalled();
    expect(content.readyAt).toBe(readyAt);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('commits folder recovery before rejecting a Ready-to-Publish action', async () => {
    const content = buildContent({
      status: 'ready',
      scheduledAt: '2026-09-03',
      productionStartedAt: new Date('2026-09-02T09:00:00.000Z'),
      readyAt: new Date('2026-09-02T10:00:00.000Z'),
      driveProjectFolderId: 'deleted-folder',
      driveProjectUrl: 'https://drive.google.com/drive/folders/deleted-folder',
    });
    mockFindByPk.mockResolvedValue(content);
    mockCheckProjectFolder.mockResolvedValue({ available: false });
    const response = createResponse();

    await publishSocialMediaContent({
      params: { id: '41' },
      body: {
        platformLinks: {
          instagram: 'https://www.instagram.com/reel/example',
          tiktok: 'https://www.tiktok.com/@example/video/123',
        },
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockDestroyAssets).toHaveBeenCalledWith({
      where: { contentId: 41 },
      transaction,
    });
    expect(content.status).toBe('planned');
    expect(content.scheduledAt).toBe('2026-09-03');
    expect(mockCompleteTask).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      message: expect.stringContaining('moved back to Planned'),
    });
  });

  it('publishes both platform links and completes the task in the same transaction', async () => {
    const content = buildContent({
      status: 'ready',
      driveProjectFolderId: 'folder-1',
      driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    const taskCompletion = {
      taskLogId: 88,
      userId: 7,
      taskDate: '2026-09-02',
      status: 'completed',
    };
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    mockCompleteTask.mockResolvedValue(taskCompletion);
    const response = createResponse();
    const platformLinks = {
      instagram: 'https://www.instagram.com/reel/example',
      tiktok: 'https://www.tiktok.com/@example/video/123',
    };

    await publishSocialMediaContent({
      params: { id: '41' },
      body: { platformLinks },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(mockCompleteTask).toHaveBeenCalledWith(expect.objectContaining({
      content,
      actorId: 7,
      platformLinks,
      publishedAt: expect.any(Date),
      transaction,
    }));
    expect(content.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'published',
      publishedAt: expect.any(Date),
      publishedBy: 7,
      publishedTaskLogId: 88,
      platformLinks,
      updatedBy: 7,
    }), { transaction });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      item: { id: 41, status: 'published' },
      taskCompletion,
    });
  });

  it('does not publish unless valid Instagram and TikTok links are both supplied', async () => {
    const response = createResponse();

    await publishSocialMediaContent({
      params: { id: '41' },
      body: {
        platformLinks: {
          instagram: 'https://www.instagram.com/reel/example',
        },
      },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ message: 'TikTok link is required.' });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('edits published links and synchronizes Task Planner evidence in one transaction', async () => {
    const previousPlatformLinks = {
      instagram: 'https://www.instagram.com/reel/old',
      tiktok: 'https://www.tiktok.com/@example/video/old',
    };
    const platformLinks = {
      instagram: 'https://www.instagram.com/reel/corrected',
      tiktok: 'https://www.tiktok.com/@example/video/corrected',
    };
    const content = buildContent({
      status: 'published',
      publishedAt: new Date('2026-09-02T12:00:00.000Z'),
      publishedBy: 7,
      publishedTaskLogId: 88,
      platformLinks: previousPlatformLinks,
    });
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await updatePublishedSocialMediaLinks({
      params: { id: '41' },
      body: { platformLinks },
      authContext: { id: 9 },
    } as unknown as AuthenticatedRequest, response);

    expect(content.update).toHaveBeenCalledWith({
      platformLinks,
      updatedBy: 9,
    }, { transaction });
    expect(mockSyncPublishedTaskEvidence).toHaveBeenCalledWith({
      content,
      actorId: 9,
      transaction,
      linkEdit: {
        editedAt: expect.any(Date),
        previousPlatformLinks,
      },
    });
    expect((content.update as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      mockSyncPublishedTaskEvidence.mock.invocationCallOrder[0],
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      item: { id: 41, status: 'published' },
    });
  });

  it('treats an exact published-link retry as idempotent and repairs task evidence', async () => {
    const platformLinks = {
      instagram: 'https://www.instagram.com/reel/example',
      tiktok: 'https://www.tiktok.com/@example/video/123',
    };
    const content = buildContent({ status: 'published', platformLinks });
    mockFindByPk.mockResolvedValue(content);
    mockLoadContent.mockResolvedValue(content);
    const response = createResponse();

    await updatePublishedSocialMediaLinks({
      params: { id: '41' },
      body: { platformLinks },
      authContext: { id: 9 },
    } as unknown as AuthenticatedRequest, response);

    expect(content.update).not.toHaveBeenCalled();
    expect(mockSyncPublishedTaskEvidence).toHaveBeenCalledWith({
      content,
      actorId: 9,
      transaction,
    });
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('does not allow publication-link edits before content is published', async () => {
    const content = buildContent({ status: 'ready' });
    mockFindByPk.mockResolvedValue(content);
    const response = createResponse();

    await updatePublishedSocialMediaLinks({
      params: { id: '41' },
      body: {
        platformLinks: {
          instagram: 'https://www.instagram.com/reel/example',
          tiktok: 'https://www.tiktok.com/@example/video/123',
        },
      },
      authContext: { id: 9 },
    } as unknown as AuthenticatedRequest, response);

    expect(content.update).not.toHaveBeenCalled();
    expect(mockSyncPublishedTaskEvidence).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(409);
  });
});
