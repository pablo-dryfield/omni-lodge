import {
  down,
  up,
  verify,
} from '../202609010001-social-media-content.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn().mockResolvedValue(undefined);
  const createTable = jest.fn().mockResolvedValue(undefined);
  const addIndex = jest.fn().mockResolvedValue(undefined);
  const dropTable = jest.fn().mockResolvedValue(undefined);
  const describeTable = jest.fn().mockResolvedValue({});
  return {
    context: {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
      },
      createTable,
      addIndex,
      dropTable,
      describeTable,
    } as never,
    transaction,
    query,
    createTable,
    addIndex,
    dropTable,
    describeTable,
  };
};

describe('Social Media content migration', () => {
  it('creates the planning domain and permission catalog in one transaction', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    expect(setup.createTable).toHaveBeenCalledWith(
      'social_media_contents',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        title: expect.objectContaining({ allowNull: false }),
        idea: expect.objectContaining({ allowNull: false }),
        on_video_captions: expect.objectContaining({ allowNull: false }),
        platform_caption: expect.objectContaining({ allowNull: false }),
        hashtags: expect.objectContaining({ allowNull: false }),
        target_platforms: expect.objectContaining({ allowNull: false }),
        drive_project_url: expect.objectContaining({ allowNull: true }),
        platform_links: expect.objectContaining({ allowNull: false }),
        thumbnail_drive_file_id: expect.objectContaining({ allowNull: true }),
        created_by: expect.objectContaining({ references: { model: 'users', key: 'id' } }),
      }),
      expect.objectContaining({ transaction: setup.transaction }),
    );
    expect(setup.createTable.mock.calls[0][1]).not.toHaveProperty('platform_url');
    const sql = setup.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain("'idea', 'planned', 'in_production', 'ready', 'published', 'archived'");
    expect(sql).toContain("jsonb_typeof(platform_links) = 'object'");
    expect(sql).toContain('roleModulePermissions');
    expect(sql).not.toContain('platform_url');
    expect(setup.query.mock.calls.some(([, options]) =>
      (options as { replacements?: { roleSlugs?: string[] } })?.replacements?.roleSlugs?.includes('social-media'),
    )).toBe(true);
    expect(setup.addIndex).toHaveBeenCalledTimes(3);
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back the table and access-control catalog', async () => {
    const setup = createContext();

    await down({ context: setup.context });

    expect(setup.dropTable).toHaveBeenCalledWith(
      'social_media_contents',
      expect.objectContaining({ transaction: setup.transaction }),
    );
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('verifies the required columns and page/module entries', async () => {
    const setup = createContext();
    setup.describeTable.mockResolvedValue({
      title: {},
      idea: {},
      on_video_captions: {},
      platform_caption: {},
      hashtags: {},
      target_platforms: {},
      status: {},
      drive_project_url: {},
      platform_links: {},
    });
    setup.query.mockResolvedValueOnce([[
      { page_exists: true, module_exists: true },
    ]]);

    await expect(verify({ context: setup.context })).resolves.toEqual({
      ok: true,
      details: {
        missingColumns: [],
        access: { page_exists: true, module_exists: true },
      },
    });
  });
});
