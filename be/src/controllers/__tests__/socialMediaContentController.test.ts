jest.mock('../../models/SocialMediaContent.js', () => ({
  __esModule: true,
  SOCIAL_MEDIA_CONTENT_STATUSES: [
    'idea',
    'planned',
    'in_production',
    'ready',
    'published',
    'archived',
  ],
  default: {
    create: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
}));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/socialMediaThumbnailStorageService.js', () => ({
  SocialMediaThumbnailUnsafeContentError: class SocialMediaThumbnailUnsafeContentError extends Error {},
  SocialMediaThumbnailValidationError: class SocialMediaThumbnailValidationError extends Error {},
  deleteSocialMediaThumbnail: jest.fn(),
  openSocialMediaThumbnailStream: jest.fn(),
  storeSocialMediaThumbnail: jest.fn(),
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn() },
}));

import type { Response } from 'express';
import { Op } from 'sequelize';
import SocialMediaContent from '../../models/SocialMediaContent';
import {
  openSocialMediaThumbnailStream,
  SocialMediaThumbnailUnsafeContentError,
  SocialMediaThumbnailValidationError,
  storeSocialMediaThumbnail,
} from '../../services/socialMediaThumbnailStorageService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import {
  archiveSocialMediaContent,
  createSocialMediaContent,
  listSelectableSocialMediaContent,
  streamSocialMediaThumbnail,
  uploadSocialMediaThumbnail,
} from '../socialMediaContentController';

const mockCreate = SocialMediaContent.create as jest.Mock;
const mockFindAll = SocialMediaContent.findAll as jest.Mock;
const mockFindByPk = SocialMediaContent.findByPk as jest.Mock;
const mockStoreThumbnail = storeSocialMediaThumbnail as jest.Mock;
const mockOpenThumbnailStream = openSocialMediaThumbnailStream as jest.Mock;

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    end: jest.fn(),
    headersSent: false,
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & { status: jest.Mock; json: jest.Mock };
};

const buildRecord = (overrides: Record<string, unknown> = {}) => {
  const record: Record<string, unknown> = {
    id: 41,
    title: 'Krakow nightlife in 15 seconds',
    idea: 'Cut from the square to the first bar and finish on the dance floor.',
    onVideoCaptions: 'POV: your first night in Krakow',
    platformCaption: 'One night. Four bars. A lot of new friends.',
    hashtags: ['krakow', 'nightlife'],
    targetPlatforms: ['instagram', 'tiktok'],
    status: 'planned',
    scheduledAt: null,
    publishedAt: null,
    driveProjectUrl: null,
    platformLinks: {},
    thumbnailUrl: null,
    thumbnailDriveFileId: null,
    thumbnailOriginalName: null,
    thumbnailMimeType: null,
    archivedAt: null,
    createdBy: 7,
    updatedBy: 7,
    createdByUser: null,
    updatedByUser: null,
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    updatedAt: new Date('2026-09-01T08:00:00.000Z'),
    ...overrides,
  };
  record.update = jest.fn(async (values: Record<string, unknown>) => {
    Object.assign(record, values);
    return record;
  });
  return record;
};

const completeBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Krakow nightlife in 15 seconds',
  idea: 'Cut from the square to the first bar and finish on the dance floor.',
  onVideoCaptions: 'POV: your first night in Krakow',
  platformCaption: 'One night. Four bars. A lot of new friends.',
  hashtags: ['#Krakow', 'nightlife', '#KRAKOW'],
  targetPlatforms: ['Instagram', 'TikTok'],
  status: 'planned',
  platformLinks: {
    Instagram: 'https://www.instagram.com/reel/example',
    TikTok: 'https://www.tiktok.com/@example/video/123',
  },
  ...overrides,
});

describe('Social Media content controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores bare deduplicated hashtags and normalized per-platform links', async () => {
    const record = buildRecord({
      hashtags: ['krakow', 'nightlife'],
      platformLinks: {
        instagram: 'https://www.instagram.com/reel/example',
        tiktok: 'https://www.tiktok.com/@example/video/123',
      },
    });
    mockCreate.mockResolvedValue(record);
    mockFindByPk.mockResolvedValue(record);
    const response = createResponse();

    await createSocialMediaContent(
      {
        body: completeBody(),
        authContext: { id: 7 },
      } as unknown as AuthenticatedRequest,
      response,
    );

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      hashtags: ['krakow', 'nightlife'],
      targetPlatforms: ['instagram', 'tiktok'],
      platformLinks: {
        instagram: 'https://www.instagram.com/reel/example',
        tiktok: 'https://www.tiktok.com/@example/video/123',
      },
      createdBy: 7,
      updatedBy: 7,
    }));
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      item: expect.objectContaining({
        hashtags: ['krakow', 'nightlife'],
        platformLinks: expect.objectContaining({ instagram: expect.any(String), tiktok: expect.any(String) }),
      }),
    }));
    expect((response.json.mock.calls[0][0] as { item: Record<string, unknown> }).item).not.toHaveProperty(
      'thumbnailDriveFileId',
    );
  });

  it('blocks planned content until the complete publishing plan exists', async () => {
    const response = createResponse();

    await createSocialMediaContent(
      {
        body: completeBody({ onVideoCaptions: '', hashtags: [] }),
        authContext: { id: 7 },
      } as unknown as AuthenticatedRequest,
      response,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      message: expect.stringContaining('on-video captions, hashtags'),
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('requires a platform link and automatically timestamps published content', async () => {
    const mismatchedResponse = createResponse();
    await createSocialMediaContent(
      {
        body: completeBody({
          status: 'published',
          targetPlatforms: ['Instagram'],
          platformLinks: { TikTok: 'https://www.tiktok.com/@example/video/123' },
        }),
        authContext: { id: 7 },
      } as unknown as AuthenticatedRequest,
      mismatchedResponse,
    );
    expect(mismatchedResponse.status).toHaveBeenCalledWith(400);
    expect(mismatchedResponse.json).toHaveBeenCalledWith({
      message: 'Platform links can only be added for selected target platforms: tiktok.',
    });

    const invalidResponse = createResponse();
    await createSocialMediaContent(
      {
        body: completeBody({ status: 'published', platformLinks: {} }),
        authContext: { id: 7 },
      } as unknown as AuthenticatedRequest,
      invalidResponse,
    );
    expect(invalidResponse.status).toHaveBeenCalledWith(400);
    expect(invalidResponse.json).toHaveBeenCalledWith({
      message: 'Add at least one published platform link before marking this content as published.',
    });

    const published = buildRecord({
      status: 'published',
      publishedAt: new Date('2026-09-01T10:00:00.000Z'),
      platformLinks: { instagram: 'https://www.instagram.com/reel/example' },
    });
    mockCreate.mockResolvedValue(published);
    mockFindByPk.mockResolvedValue(published);
    const response = createResponse();
    await createSocialMediaContent(
      {
        body: completeBody({
          status: 'published',
          publishedAt: null,
          platformLinks: { instagram: 'https://www.instagram.com/reel/example' },
        }),
        authContext: { id: 7 },
      } as unknown as AuthenticatedRequest,
      response,
    );
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'published',
      publishedAt: expect.any(Date),
    }));
  });

  it('includes ideas in selector results and marks them as not ready for task completion', async () => {
    const ideas = Array.from({ length: 101 }, (_, index) =>
      buildRecord({ id: index + 1, status: 'idea', hashtags: [], targetPlatforms: [] }));
    mockFindAll.mockResolvedValue([
      ...ideas,
      buildRecord({ id: 1002, status: 'planned' }),
    ]);
    const response = createResponse();

    await listSelectableSocialMediaContent(
      { query: {} } as unknown as AuthenticatedRequest,
      response,
    );

    expect(mockFindAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { [Op.ne]: 'archived' } },
    }));
    expect(mockFindAll.mock.calls[0][0]).not.toHaveProperty('limit');
    const payload = response.json.mock.calls[0][0] as { items: Array<Record<string, unknown>> };
    expect(payload.items).toHaveLength(102);
    expect(payload.items[0]).toEqual(expect.objectContaining({ id: 1, status: 'idea', isTaskReady: false }));
    expect(payload.items[101]).toEqual(expect.objectContaining({ id: 1002, status: 'planned', isTaskReady: true }));
  });

  it('archives instead of hard-deleting content', async () => {
    const record = buildRecord({ status: 'ready' });
    mockFindByPk.mockResolvedValue(record);
    const response = createResponse();

    await archiveSocialMediaContent(
      { params: { id: '41' }, authContext: { id: 22 } } as unknown as AuthenticatedRequest,
      response,
    );

    expect(record.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'archived',
      archivedAt: expect.any(Date),
      updatedBy: 22,
    }));
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('returns the stable authenticated thumbnail URL after a Drive upload', async () => {
    const record = buildRecord();
    mockFindByPk.mockResolvedValue(record);
    mockStoreThumbnail.mockResolvedValue({
      driveFileId: 'drive-file-1',
      thumbnailUrl: '/api/social-media/content/41/thumbnail',
      originalName: 'cover.webp',
      mimeType: 'image/webp',
    });
    const response = createResponse();

    await uploadSocialMediaThumbnail(
      {
        params: { id: '41' },
        authContext: { id: 7 },
        file: {
          originalname: 'cover.webp',
          mimetype: 'image/webp',
          buffer: Buffer.from('image'),
        },
      } as unknown as AuthenticatedRequest,
      response,
    );

    expect(record.update).toHaveBeenCalledWith(expect.objectContaining({
      thumbnailDriveFileId: 'drive-file-1',
      thumbnailUrl: '/api/social-media/content/41/thumbnail',
    }));
    expect(response.status).toHaveBeenCalledWith(200);

    mockStoreThumbnail.mockRejectedValueOnce(
      new SocialMediaThumbnailValidationError(
        'The thumbnail contents do not match the selected image format.',
      ),
    );
    const invalidResponse = createResponse();
    await uploadSocialMediaThumbnail(
      {
        params: { id: '41' },
        authContext: { id: 7 },
        file: {
          originalname: 'fake.webp',
          mimetype: 'image/webp',
          buffer: Buffer.from('not really an image'),
        },
      } as unknown as AuthenticatedRequest,
      invalidResponse,
    );
    expect(invalidResponse.status).toHaveBeenCalledWith(400);
    expect(invalidResponse.json).toHaveBeenCalledWith({
      message: 'The thumbnail contents do not match the selected image format.',
    });
  });

  it('streams only safe image content with anti-sniff and restrictive response headers', async () => {
    mockFindByPk.mockResolvedValue(buildRecord({ thumbnailDriveFileId: 'drive-file-1' }));
    const stream = {
      on: jest.fn().mockReturnThis(),
      pipe: jest.fn(),
    };
    mockOpenThumbnailStream.mockResolvedValue({ stream, mimeType: 'image/webp' });
    const response = createResponse();

    await streamSocialMediaThumbnail(
      { params: { id: '41' } } as unknown as AuthenticatedRequest,
      response,
    );

    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "default-src 'none'; sandbox",
    );
    expect(response.setHeader).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'same-origin');
    expect(stream.pipe).toHaveBeenCalledWith(response);

    mockOpenThumbnailStream.mockRejectedValueOnce(
      new SocialMediaThumbnailUnsafeContentError('Stored thumbnail has an unsupported image format.'),
    );
    const unsafeResponse = createResponse();
    await streamSocialMediaThumbnail(
      { params: { id: '41' } } as unknown as AuthenticatedRequest,
      unsafeResponse,
    );
    expect(unsafeResponse.status).toHaveBeenCalledWith(415);
    expect(unsafeResponse.json).toHaveBeenCalledWith({
      message: 'Stored thumbnail has an unsupported image format.',
    });
  });
});
