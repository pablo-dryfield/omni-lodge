import {
  down,
  up,
  verify,
} from '../202609020001-social-media-production-workflow.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const context = {
    sequelize: {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn().mockResolvedValue(undefined),
    },
    addColumn: jest.fn().mockResolvedValue(undefined),
    removeColumn: jest.fn().mockResolvedValue(undefined),
    createTable: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    addIndex: jest.fn().mockResolvedValue(undefined),
    removeIndex: jest.fn().mockResolvedValue(undefined),
    describeTable: jest.fn().mockResolvedValue({}),
  };
  return { context: context as never, transaction, ...context };
};

describe('Social Media production workflow migration', () => {
  it('adds date-only planning, audit columns, assets, and private Drive indexes atomically', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    expect(setup.addColumn).toHaveBeenCalledTimes(5);
    expect(setup.addColumn).toHaveBeenCalledWith(
      'social_media_contents',
      'published_task_log_id',
      expect.objectContaining({ references: { model: 'am_task_logs', key: 'id' } }),
      expect.objectContaining({ transaction: setup.transaction }),
    );
    expect(setup.createTable).toHaveBeenCalledWith(
      'social_media_content_assets',
      expect.objectContaining({
        content_id: expect.objectContaining({
          references: { model: 'social_media_contents', key: 'id' },
          onDelete: 'CASCADE',
        }),
        drive_file_id: expect.objectContaining({ allowNull: false }),
        size_bytes: expect.objectContaining({ allowNull: false }),
      }),
      expect.objectContaining({ transaction: setup.transaction }),
    );
    const sql = setup.sequelize.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('ALTER COLUMN scheduled_at TYPE DATE');
    expect(sql).toContain('["instagram", "tiktok"]');
    expect(sql).toContain("'final_video', 'raw_material', 'project_file'");
    expect(setup.addIndex).toHaveBeenCalledTimes(5);
    expect(setup.addIndex).toHaveBeenCalledWith(
      'social_media_content_assets',
      ['content_id'],
      expect.objectContaining({
        name: 'social_media_content_assets_one_final_video_uq',
        unique: true,
        where: { kind: 'final_video' },
        transaction: setup.transaction,
      }),
    );
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });

  it('removes workflow storage and restores the timestamp shape on rollback', async () => {
    const setup = createContext();

    await down({ context: setup.context });

    expect(setup.dropTable).toHaveBeenCalledWith(
      'social_media_content_assets',
      expect.objectContaining({ transaction: setup.transaction }),
    );
    expect(setup.removeColumn).toHaveBeenCalledTimes(5);
    const sql = setup.sequelize.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('ALTER COLUMN scheduled_at TYPE TIMESTAMPTZ');
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('verifies all workflow columns, the asset table, and the date-only column', async () => {
    const setup = createContext();
    setup.describeTable.mockResolvedValue({
      drive_project_folder_id: {},
      production_started_at: {},
      ready_at: {},
      published_by: {},
      published_task_log_id: {},
    });
    setup.sequelize.query.mockResolvedValueOnce([[
      {
        asset_table_exists: true,
        final_video_unique_index_exists: true,
        scheduled_at_is_date: true,
      },
    ]]);

    await expect(verify({ context: setup.context })).resolves.toEqual({
      ok: true,
      details: {
        missingColumns: [],
        asset_table_exists: true,
        final_video_unique_index_exists: true,
        scheduled_at_is_date: true,
      },
    });
  });
});
