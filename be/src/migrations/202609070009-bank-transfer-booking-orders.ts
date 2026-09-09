import { DataTypes, Op, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'storefront_orders';
const RESERVATION_TABLE = 'storefront_order_resource_reservations';
const PAYMENT_REFERENCE_INDEX = 'storefront_orders_payment_reference_key';
const IDEMPOTENCY_KEY_INDEX = 'storefront_orders_idempotency_key_key';
const BANK_TRANSFER_QUEUE_INDEX = 'storefront_orders_bank_transfer_queue_idx';
const RESERVATION_ORDER_KEY = 'storefront_order_resource_reservations_order_key';
const RESERVATION_ORDER_ITEM_INDEX = 'storefront_order_resource_reservations_order_item_idx';
const ACTIVE_INVENTORY_INDEX = 'storefront_order_resource_reservations_inventory_active_idx';
const ACTIVE_PROMOTION_INDEX = 'storefront_order_resource_reservations_promotion_active_idx';
const RESERVATION_EXPIRY_INDEX = 'storefront_order_resource_reservations_expiry_idx';

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
] as const;

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
] as const;

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.addColumn(TABLE, 'order_source', {
      type: DataTypes.STRING(32),
      allowNull: true,
    }, { transaction });
    await context.addColumn(TABLE, 'payment_method', {
      type: DataTypes.STRING(32),
      allowNull: true,
    }, { transaction });
    await context.addColumn(TABLE, 'created_by_user_id', {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    }, { transaction });
    await context.addColumn(TABLE, 'payment_received_by_user_id', {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    }, { transaction });
    await context.addColumn(TABLE, 'payment_reference', {
      type: DataTypes.STRING(64),
      allowNull: true,
    }, { transaction });
    await context.addColumn(TABLE, 'payment_due_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    await context.addColumn(TABLE, 'bank_transfer_email_sent_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    await context.addColumn(TABLE, 'bank_transfer_cancellation_email_sent_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    await context.addColumn(TABLE, 'idempotency_key', {
      type: DataTypes.UUID,
      allowNull: true,
    }, { transaction });
    await context.addColumn(TABLE, 'idempotency_request_hash', {
      type: DataTypes.STRING(64),
      allowNull: true,
    }, { transaction });
    await context.addColumn(TABLE, 'payment_note', {
      type: DataTypes.TEXT,
      allowNull: true,
    }, { transaction });

    await context.sequelize.query(
      `UPDATE "${TABLE}"
          SET "order_source" = 'storefront',
              "payment_method" = CASE
                WHEN "stripe_checkout_session_id" IS NOT NULL
                  OR "stripe_payment_intent_id" IS NOT NULL
                  THEN 'stripe'
                WHEN COALESCE("total", 0) = 0
                  THEN 'free'
                ELSE 'unknown'
              END
        WHERE "order_source" IS NULL
           OR "payment_method" IS NULL;`,
      { transaction },
    );

    await context.changeColumn(TABLE, 'order_source', {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'storefront',
    }, { transaction });
    await context.changeColumn(TABLE, 'payment_method', {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'unknown',
    }, { transaction });

    await context.createTable(RESERVATION_TABLE, {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      order_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: TABLE, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      order_item_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'storefront_order_items', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      resource_type: { type: DataTypes.STRING(24), allowNull: false },
      reservation_key: { type: DataTypes.STRING(180), allowNull: false },
      inventory_item_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'inventory_items', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      promotion_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'storefront_promotions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      addon_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'addons', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      variant: { type: DataTypes.STRING(40), allowNull: true },
      quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'held' },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      commit_expires_at: { type: DataTypes.DATE, allowNull: true },
      consumed_at: { type: DataTypes.DATE, allowNull: true },
      released_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });
    await context.addConstraint(RESERVATION_TABLE, {
      fields: ['resource_type'],
      type: 'check',
      where: { resource_type: { [Op.in]: ['inventory', 'promotion'] } },
      name: 'storefront_order_resource_reservations_resource_type_check',
      transaction,
    });
    await context.addConstraint(RESERVATION_TABLE, {
      fields: ['status'],
      type: 'check',
      where: { status: { [Op.in]: ['held', 'consumed', 'released'] } },
      name: 'storefront_order_resource_reservations_status_check',
      transaction,
    });
    await context.addConstraint(RESERVATION_TABLE, {
      fields: ['quantity'],
      type: 'check',
      where: { quantity: { [Op.gt]: 0 } },
      name: 'storefront_order_resource_reservations_quantity_check',
      transaction,
    });
    await context.addConstraint(RESERVATION_TABLE, {
      fields: ['resource_type', 'order_item_id', 'inventory_item_id', 'promotion_id', 'addon_id'],
      type: 'check',
      where: {
        [Op.or]: [
          {
            resource_type: 'inventory',
            order_item_id: { [Op.ne]: null },
            inventory_item_id: { [Op.ne]: null },
            promotion_id: null,
            addon_id: { [Op.ne]: null },
          },
          {
            resource_type: 'promotion',
            order_item_id: null,
            inventory_item_id: null,
            promotion_id: { [Op.ne]: null },
            addon_id: null,
          },
        ],
      },
      name: 'storefront_order_resource_reservations_resource_identity_check',
      transaction,
    });
    await context.addIndex(RESERVATION_TABLE, ['order_id', 'reservation_key'], {
      name: RESERVATION_ORDER_KEY,
      unique: true,
      transaction,
    });
    await context.addIndex(RESERVATION_TABLE, ['order_item_id', 'status'], {
      name: RESERVATION_ORDER_ITEM_INDEX,
      where: { resource_type: 'inventory' },
      transaction,
    });
    await context.addIndex(RESERVATION_TABLE, ['inventory_item_id', 'expires_at'], {
      name: ACTIVE_INVENTORY_INDEX,
      where: { resource_type: 'inventory', status: { [Op.in]: ['held', 'consumed'] } },
      transaction,
    });
    await context.addIndex(RESERVATION_TABLE, ['promotion_id', 'expires_at'], {
      name: ACTIVE_PROMOTION_INDEX,
      where: { resource_type: 'promotion', status: 'held' },
      transaction,
    });
    await context.addIndex(RESERVATION_TABLE, ['status', 'expires_at'], {
      name: RESERVATION_EXPIRY_INDEX,
      transaction,
    });

    await context.addIndex(TABLE, ['payment_reference'], {
      name: PAYMENT_REFERENCE_INDEX,
      unique: true,
      transaction,
    });
    await context.addIndex(TABLE, ['idempotency_key'], {
      name: IDEMPOTENCY_KEY_INDEX,
      unique: true,
      transaction,
    });
    await context.addIndex(TABLE, ['payment_status', 'payment_due_at', 'created_at'], {
      name: BANK_TRANSFER_QUEUE_INDEX,
      where: {
        order_source: 'backoffice',
        payment_method: 'bank_transfer',
      },
      transaction,
    });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.removeIndex(TABLE, BANK_TRANSFER_QUEUE_INDEX, { transaction });
    await context.removeIndex(TABLE, IDEMPOTENCY_KEY_INDEX, { transaction });
    await context.removeIndex(TABLE, PAYMENT_REFERENCE_INDEX, { transaction });
    await context.dropTable(RESERVATION_TABLE, { transaction });

    for (const column of [...ADDED_COLUMNS].reverse()) {
      await context.removeColumn(TABLE, column, { transaction });
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [columnRows] = await context.sequelize.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = '${TABLE}'
        AND column_name IN (${ADDED_COLUMNS.map((column) => `'${column}'`).join(', ')});`,
  );
  const [indexRows] = await context.sequelize.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = '${TABLE}'
        AND indexname IN ('${PAYMENT_REFERENCE_INDEX}', '${IDEMPOTENCY_KEY_INDEX}', '${BANK_TRANSFER_QUEUE_INDEX}');`,
  );
  const [backfillRows] = await context.sequelize.query(
    `SELECT COUNT(*)::integer AS invalid_count
       FROM "${TABLE}"
      WHERE "order_source" IS NULL
         OR "payment_method" IS NULL;`,
  );
  const [reservationColumnRows] = await context.sequelize.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = '${RESERVATION_TABLE}';`,
  );
  const [reservationIndexRows] = await context.sequelize.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = '${RESERVATION_TABLE}';`,
  );

  const columns = new Set((columnRows as Array<{ column_name: string }>).map((row) => row.column_name));
  const indexes = new Set((indexRows as Array<{ indexname: string }>).map((row) => row.indexname));
  const missingColumns = ADDED_COLUMNS.filter((column) => !columns.has(column));
  const missingIndexes = [PAYMENT_REFERENCE_INDEX, IDEMPOTENCY_KEY_INDEX, BANK_TRANSFER_QUEUE_INDEX]
    .filter((index) => !indexes.has(index));
  const invalidCount = Number((backfillRows as Array<{ invalid_count: number | string }>)[0]?.invalid_count ?? 0);
  const reservationColumns = new Set(
    (reservationColumnRows as Array<{ column_name: string }>).map((row) => row.column_name),
  );
  const reservationIndexes = new Set(
    (reservationIndexRows as Array<{ indexname: string }>).map((row) => row.indexname),
  );
  const missingReservationColumns = RESERVATION_COLUMNS.filter(
    (column) => !reservationColumns.has(column),
  );
  const missingReservationIndexes = [
    RESERVATION_ORDER_KEY,
    RESERVATION_ORDER_ITEM_INDEX,
    ACTIVE_INVENTORY_INDEX,
    ACTIVE_PROMOTION_INDEX,
    RESERVATION_EXPIRY_INDEX,
  ].filter((index) => !reservationIndexes.has(index));

  return {
    ok: missingColumns.length === 0
      && missingIndexes.length === 0
      && invalidCount === 0
      && missingReservationColumns.length === 0
      && missingReservationIndexes.length === 0,
    details: {
      missingColumns,
      missingIndexes,
      invalidCount,
      missingReservationColumns,
      missingReservationIndexes,
    },
  };
}
