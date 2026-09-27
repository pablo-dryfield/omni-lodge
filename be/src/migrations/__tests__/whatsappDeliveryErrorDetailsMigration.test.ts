import { DataTypes } from 'sequelize';
import { down, up, verify } from '../202609280001-whatsapp-delivery-error-details.js';

const setup = () => {
  const transaction = { id: 'whatsapp-delivery-error-details' };
  const context = {
    sequelize: {
      transaction: jest.fn(async (operation: (value: unknown) => Promise<void>) => operation(transaction)),
      query: jest.fn(),
    },
    addColumn: jest.fn().mockResolvedValue(undefined),
    removeColumn: jest.fn().mockResolvedValue(undefined),
    describeTable: jest.fn().mockResolvedValue({}),
  };
  return { context, transaction };
};

describe('WhatsApp delivery error details migration', () => {
  it('adds bounded nullable diagnostic columns transactionally without backfilling', async () => {
    const { context, transaction } = setup();

    await up({ context: context as never });

    expect(context.describeTable).toHaveBeenCalledWith('whatsapp_messages', { transaction });
    expect(context.addColumn).toHaveBeenCalledTimes(4);
    expect(context.addColumn).toHaveBeenNthCalledWith(1, 'whatsapp_messages', 'delivery_error_code', {
      type: DataTypes.STRING(32),
      allowNull: true,
    }, { transaction });
    expect(context.addColumn).toHaveBeenNthCalledWith(2, 'whatsapp_messages', 'delivery_error_title', {
      type: DataTypes.STRING(256),
      allowNull: true,
    }, { transaction });
    expect(context.addColumn).toHaveBeenNthCalledWith(3, 'whatsapp_messages', 'delivery_error_details', {
      type: DataTypes.STRING(512),
      allowNull: true,
    }, { transaction });
    expect(context.addColumn).toHaveBeenNthCalledWith(4, 'whatsapp_messages', 'delivery_error_updated_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    expect(context.sequelize.query).not.toHaveBeenCalled();
  });

  it('adds only missing columns when retrying a partially applied migration', async () => {
    const { context, transaction } = setup();
    context.describeTable.mockResolvedValue({ delivery_error_code: {} });

    await up({ context: context as never });

    expect(context.addColumn).toHaveBeenCalledTimes(3);
    expect(context.addColumn).toHaveBeenNthCalledWith(1, 'whatsapp_messages', 'delivery_error_title', {
      type: DataTypes.STRING(256),
      allowNull: true,
    }, { transaction });
    expect(context.addColumn).toHaveBeenNthCalledWith(2, 'whatsapp_messages', 'delivery_error_details', {
      type: DataTypes.STRING(512),
      allowNull: true,
    }, { transaction });
    expect(context.addColumn).toHaveBeenNthCalledWith(3, 'whatsapp_messages', 'delivery_error_updated_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
  });

  it('is a no-op when retrying after every column already exists', async () => {
    const { context } = setup();
    context.describeTable.mockResolvedValue({
      delivery_error_code: {},
      delivery_error_title: {},
      delivery_error_details: {},
      delivery_error_updated_at: {},
    });

    await up({ context: context as never });

    expect(context.addColumn).not.toHaveBeenCalled();
  });

  it('propagates schema failures so the managed transaction rolls back', async () => {
    const { context } = setup();
    context.addColumn.mockRejectedValueOnce(new Error('add column failed'));

    await expect(up({ context: context as never })).rejects.toThrow('add column failed');
  });

  it('removes the diagnostic columns in reverse order within a transaction', async () => {
    const { context, transaction } = setup();
    context.describeTable.mockResolvedValue({
      delivery_error_code: {},
      delivery_error_title: {},
      delivery_error_details: {},
      delivery_error_updated_at: {},
    });

    await down({ context: context as never });

    expect(context.describeTable).toHaveBeenCalledWith('whatsapp_messages', { transaction });
    expect(context.removeColumn).toHaveBeenCalledTimes(4);
    expect(context.removeColumn).toHaveBeenNthCalledWith(
      1,
      'whatsapp_messages',
      'delivery_error_updated_at',
      { transaction },
    );
    expect(context.removeColumn).toHaveBeenNthCalledWith(
      2,
      'whatsapp_messages',
      'delivery_error_details',
      { transaction },
    );
    expect(context.removeColumn).toHaveBeenNthCalledWith(
      3,
      'whatsapp_messages',
      'delivery_error_title',
      { transaction },
    );
    expect(context.removeColumn).toHaveBeenNthCalledWith(
      4,
      'whatsapp_messages',
      'delivery_error_code',
      { transaction },
    );
  });

  it('removes only columns still present when retrying a partial rollback', async () => {
    const { context, transaction } = setup();
    context.describeTable.mockResolvedValue({
      delivery_error_code: {},
      delivery_error_details: {},
    });

    await down({ context: context as never });

    expect(context.removeColumn).toHaveBeenCalledTimes(2);
    expect(context.removeColumn).toHaveBeenNthCalledWith(
      1,
      'whatsapp_messages',
      'delivery_error_details',
      { transaction },
    );
    expect(context.removeColumn).toHaveBeenNthCalledWith(
      2,
      'whatsapp_messages',
      'delivery_error_code',
      { transaction },
    );
  });

  it('is a no-op when rollback is retried after every column was removed', async () => {
    const { context } = setup();

    await down({ context: context as never });

    expect(context.removeColumn).not.toHaveBeenCalled();
  });

  it.each([
    [true, [
      'delivery_error_code',
      'delivery_error_title',
      'delivery_error_details',
      'delivery_error_updated_at',
    ]],
    [false, ['delivery_error_code', 'delivery_error_title', 'delivery_error_details']],
  ])('reports whether every diagnostic column exists (%s)', async (expected, presentColumns) => {
    const { context } = setup();
    context.describeTable.mockResolvedValue(
      Object.fromEntries(presentColumns.map((column) => [column, {}])),
    );

    await expect(verify({ context: context as never })).resolves.toMatchObject({ ok: expected });
  });
});
