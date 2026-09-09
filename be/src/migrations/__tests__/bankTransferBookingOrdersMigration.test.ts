import {
  down,
  up,
  verify,
} from '../202609070009-bank-transfer-booking-orders.js';

const ADDED_COLUMNS = [
  'order_source',
  'payment_method',
  'created_by_user_id',
  'payment_received_by_user_id',
  'payment_reference',
  'payment_due_at',
  'bank_transfer_email_sent_at',
  'bank_transfer_cancellation_email_sent_at',
  'idempotency_key',
  'idempotency_request_hash',
  'payment_note',
];

const RESERVATION_COLUMNS = [
  'id',
  'order_id',
  'order_item_id',
  'resource_type',
  'reservation_key',
  'inventory_item_id',
  'promotion_id',
  'addon_id',
  'variant',
  'quantity',
  'status',
  'expires_at',
  'commit_expires_at',
  'consumed_at',
  'released_at',
  'created_at',
  'updated_at',
];

const RESERVATION_INDEXES = [
  'storefront_order_resource_reservations_order_key',
  'storefront_order_resource_reservations_order_item_idx',
  'storefront_order_resource_reservations_inventory_active_idx',
  'storefront_order_resource_reservations_promotion_active_idx',
  'storefront_order_resource_reservations_expiry_idx',
];

const setup = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const context = {
    sequelize: {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn().mockResolvedValue([[], undefined]),
    },
    addColumn: jest.fn().mockResolvedValue(undefined),
    changeColumn: jest.fn().mockResolvedValue(undefined),
    createTable: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    addConstraint: jest.fn().mockResolvedValue(undefined),
    addIndex: jest.fn().mockResolvedValue(undefined),
    removeIndex: jest.fn().mockResolvedValue(undefined),
    removeColumn: jest.fn().mockResolvedValue(undefined),
  };
  return { context, transaction };
};

describe('bank transfer booking orders migration', () => {
  it('adds bank-transfer order metadata, backfills existing orders, and creates indexes', async () => {
    const { context, transaction } = setup();

    await up({ context: context as never });

    expect(context.addColumn.mock.calls.map(([, column]) => column)).toEqual(ADDED_COLUMNS);
    expect(context.addColumn).toHaveBeenCalledWith(
      'storefront_orders',
      'created_by_user_id',
      expect.objectContaining({
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      }),
      { transaction },
    );
    expect(context.addColumn).toHaveBeenCalledWith(
      'storefront_orders',
      'payment_received_by_user_id',
      expect.objectContaining({
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      }),
      { transaction },
    );

    const backfillSql = String(context.sequelize.query.mock.calls[0][0]);
    expect(backfillSql).toContain('"order_source" = \'storefront\'');
    expect(backfillSql).toContain('"stripe_checkout_session_id" IS NOT NULL');
    expect(backfillSql).toContain('"stripe_payment_intent_id" IS NOT NULL');
    expect(backfillSql).toContain("THEN 'stripe'");
    expect(backfillSql).toContain('WHEN COALESCE("total", 0) = 0');
    expect(backfillSql).toContain("THEN 'free'");
    expect(backfillSql).toContain("ELSE 'unknown'");
    expect(context.sequelize.query.mock.calls[0][1]).toEqual({ transaction });

    expect(context.changeColumn).toHaveBeenCalledWith(
      'storefront_orders',
      'order_source',
      expect.objectContaining({ allowNull: false, defaultValue: 'storefront' }),
      { transaction },
    );
    expect(context.createTable).toHaveBeenCalledWith(
      'storefront_order_resource_reservations',
      expect.objectContaining({
        order_id: expect.objectContaining({
          allowNull: false,
          references: { model: 'storefront_orders', key: 'id' },
          onDelete: 'CASCADE',
        }),
        order_item_id: expect.objectContaining({
          references: { model: 'storefront_order_items', key: 'id' },
          onDelete: 'CASCADE',
        }),
        inventory_item_id: expect.objectContaining({
          references: { model: 'inventory_items', key: 'id' },
        }),
        promotion_id: expect.objectContaining({
          references: { model: 'storefront_promotions', key: 'id' },
        }),
      }),
      { transaction },
    );
    expect(context.addConstraint).toHaveBeenCalledTimes(4);
    for (const indexName of RESERVATION_INDEXES) {
      expect(context.addIndex).toHaveBeenCalledWith(
        'storefront_order_resource_reservations',
        expect.any(Array),
        expect.objectContaining({ name: indexName, transaction }),
      );
    }
    expect(context.changeColumn).toHaveBeenCalledWith(
      'storefront_orders',
      'payment_method',
      expect.objectContaining({ allowNull: false, defaultValue: 'unknown' }),
      { transaction },
    );
    expect(context.addIndex).toHaveBeenCalledWith(
      'storefront_orders',
      ['payment_reference'],
      expect.objectContaining({ name: 'storefront_orders_payment_reference_key', unique: true, transaction }),
    );
    expect(context.addIndex).toHaveBeenCalledWith(
      'storefront_orders',
      ['idempotency_key'],
      expect.objectContaining({ name: 'storefront_orders_idempotency_key_key', unique: true, transaction }),
    );
    expect(context.addIndex).toHaveBeenCalledWith(
      'storefront_orders',
      ['payment_status', 'payment_due_at', 'created_at'],
      expect.objectContaining({
        name: 'storefront_orders_bank_transfer_queue_idx',
        where: { order_source: 'backoffice', payment_method: 'bank_transfer' },
        transaction,
      }),
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('removes indexes and columns in reverse order on rollback', async () => {
    const { context, transaction } = setup();

    await down({ context: context as never });

    expect(context.removeIndex.mock.calls.map(([, index]) => index)).toEqual([
      'storefront_orders_bank_transfer_queue_idx',
      'storefront_orders_idempotency_key_key',
      'storefront_orders_payment_reference_key',
    ]);
    expect(context.removeColumn.mock.calls.map(([, column]) => column)).toEqual([...ADDED_COLUMNS].reverse());
    expect(context.removeColumn).toHaveBeenCalledWith(
      'storefront_orders',
      'order_source',
      { transaction },
    );
    expect(context.dropTable).toHaveBeenCalledWith(
      'storefront_order_resource_reservations',
      { transaction },
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('rolls back when a schema change fails', async () => {
    const { context, transaction } = setup();
    context.addColumn.mockRejectedValueOnce(new Error('schema update failed'));

    await expect(up({ context: context as never })).rejects.toThrow('schema update failed');

    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('verifies all columns, indexes, and non-null backfill values', async () => {
    const { context } = setup();
    context.sequelize.query
      .mockResolvedValueOnce([ADDED_COLUMNS.map((column_name) => ({ column_name })), undefined])
      .mockResolvedValueOnce([[
        { indexname: 'storefront_orders_payment_reference_key' },
        { indexname: 'storefront_orders_idempotency_key_key' },
        { indexname: 'storefront_orders_bank_transfer_queue_idx' },
      ], undefined])
      .mockResolvedValueOnce([[{ invalid_count: '0' }], undefined])
      .mockResolvedValueOnce([RESERVATION_COLUMNS.map((column_name) => ({ column_name })), undefined])
      .mockResolvedValueOnce([RESERVATION_INDEXES.map((indexname) => ({ indexname })), undefined]);

    await expect(verify({ context: context as never })).resolves.toEqual({
      ok: true,
      details: {
        missingColumns: [],
        missingIndexes: [],
        invalidCount: 0,
        missingReservationColumns: [],
        missingReservationIndexes: [],
      },
    });
  });
});
