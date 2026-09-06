import { DataTypes } from 'sequelize';
import { down, up, verify } from '../202609060003-social-media-producer-attribution';

const setup = () => {
  const transaction = { id: 'attribution-migration' };
  const context = {
    sequelize: {
      transaction: jest.fn(async (operation: (value: unknown) => Promise<void>) => operation(transaction)),
      query: jest.fn(),
    },
    addColumn: jest.fn().mockResolvedValue(undefined),
    removeColumn: jest.fn().mockResolvedValue(undefined),
    describeTable: jest.fn().mockResolvedValue({ produced_by: { type: 'INTEGER', allowNull: true } }),
  };
  return { context, transaction };
};

describe('Social Media producer attribution migration', () => {
  it('adds nullable producer attribution in a transaction without inventing historical attribution', async () => {
    const { context, transaction } = setup();
    await up({ context: context as never });
    expect(context.addColumn).toHaveBeenCalledTimes(1);
    expect(context.addColumn).toHaveBeenCalledWith('social_media_contents', 'produced_by', {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    }, { transaction });
    expect(context.sequelize.query).not.toHaveBeenCalled();
  });

  it('propagates schema failures so the managed transaction rolls back', async () => {
    const { context } = setup();
    context.addColumn.mockRejectedValue(new Error('foreign key failed'));
    await expect(up({ context: context as never })).rejects.toThrow('foreign key failed');
  });

  it('only removes producer attribution when reversed', async () => {
    const { context } = setup();
    await down({ context: context as never });
    expect(context.removeColumn).toHaveBeenCalledTimes(1);
    expect(context.removeColumn).toHaveBeenCalledWith('social_media_contents', 'produced_by');
  });

  it.each([true, false])('reports whether the producer column exists (%s)', async (present) => {
    const { context } = setup();
    context.describeTable.mockResolvedValue(present ? { produced_by: { type: 'INTEGER', allowNull: true } } : {} as never);
    await expect(verify({ context: context as never })).resolves.toEqual({
      ok: present, details: { producedByPresent: present },
    });
  });
});
