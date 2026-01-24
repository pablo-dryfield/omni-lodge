import type { QueryInterface } from 'sequelize';
import { DataTypes, QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };
const debug = (process.env.MIGRATION_DEBUG ?? '').toLowerCase() === 'true';
const log = (...args: unknown[]) => {
    if (debug) {
        console.log('[counter-registry]', ...args);
    }
};

export async function up({ context }: MigrationParams): Promise<void> {
    const qi = context;
    const transaction = await qi.sequelize.transaction();
    try {
        log('start');
        // Counters adjustments
        const countersTable = 'counters';
        const counterUsersTable = 'counterUsers';
        log('describe counters');
        const countersTableDescription = await (qi as any).describeTable(countersTable, { transaction });
        log('change counters.date');
        await qi.changeColumn(countersTable, 'date', {
            type: DataTypes.DATEONLY,
            allowNull: false,
        }, { transaction });
        if ('total' in countersTableDescription) {
            log('remove counters.total');
            await qi.removeColumn(countersTable, 'total', { transaction });
        }
        log('describe counters after');
        const counterColumnsAfter = await (qi as any).describeTable(countersTable, { transaction });
        log('counter columns', Object.keys(counterColumnsAfter));
        log('has product_id', 'product_id' in counterColumnsAfter);
        if (!('product_id' in counterColumnsAfter)) {
            log('add counters.product_id');
            await qi.addColumn(countersTable, 'product_id', {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'products',
                    key: 'id',
                },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL',
            }, { transaction });
        }
        log('has status', 'status' in counterColumnsAfter);
        if (!('status' in counterColumnsAfter)) {
            log('add counters.status');
            await qi.addColumn(countersTable, 'status', {
                type: DataTypes.ENUM('draft', 'final'),
                allowNull: false,
                defaultValue: 'draft',
            }, { transaction });
        }
        log('has notes', 'notes' in counterColumnsAfter);
        if (!('notes' in counterColumnsAfter)) {
            log('add counters.notes');
            await qi.addColumn(countersTable, 'notes', {
                type: DataTypes.TEXT,
                allowNull: true,
            }, { transaction });
        }
        log('before counters indexes');
        log('show counters indexes');
        const counterIndexes = (await (qi as any).showIndex(countersTable, { transaction })) as Array<{ name?: string }>;
        const hasDateUnique = counterIndexes.some((index) => index.name === 'counters_date_unique');
        if (!hasDateUnique) {
            log('add counters_date_unique');
            await qi.addIndex(countersTable, ['date'], {
                unique: true,
                name: 'counters_date_unique',
                transaction,
            });
        }
        const hasProductIndex = counterIndexes.some((index) => index.name === 'counters_product_id_idx');
        if (!hasProductIndex) {
            log('add counters_product_id_idx');
            await qi.addIndex(countersTable, ['product_id'], {
                name: 'counters_product_id_idx',
                transaction,
            });
        }
        const hasUserIdIndex = counterIndexes.some((index) => index.name === 'counters_user_id_idx');
        if (!hasUserIdIndex) {
            log('add counters_user_id_idx');
            await qi.addIndex(countersTable, ['userId'], {
                name: 'counters_user_id_idx',
                transaction,
            });
        }
        log('counters adjusted');
        // CounterUsers adjustments
        const counterUsersDescription = (await (qi as any).describeTable(counterUsersTable, { transaction })) as Record<string, unknown>;
        if (!('counter_id' in counterUsersDescription)) {
            await qi.renameColumn(counterUsersTable, 'counterId', 'counter_id', { transaction });
        }
        if (!('user_id' in counterUsersDescription)) {
            await qi.renameColumn(counterUsersTable, 'userId', 'user_id', { transaction });
        }
        const counterUsersColumnsAfter = (await (qi as any).describeTable(counterUsersTable, { transaction })) as Record<string, unknown>;
        if (!('role' in counterUsersColumnsAfter)) {
            await qi.addColumn(counterUsersTable, 'role', {
                type: DataTypes.ENUM('guide', 'assistant_manager'),
                allowNull: false,
                defaultValue: 'guide',
            }, { transaction });
        }
        const counterUsersIndexes = (await (qi as any).showIndex(counterUsersTable, { transaction })) as Array<{ name?: string }>;
        const hasStaffUnique = counterUsersIndexes.some((index) => index.name === 'counter_users_counter_user_unique');
        if (!hasStaffUnique) {
            await qi.addIndex(counterUsersTable, ['counter_id', 'user_id'], {
                unique: true,
                name: 'counter_users_counter_user_unique',
                transaction,
            });
        }
        log('counterUsers adjusted');
        // Addons table
        const addonsExists = (await qi.sequelize.query(
            `SELECT to_regclass('public.addons') as table`,
            { plain: true, transaction, type: QueryTypes.SELECT },
        )) as { table?: string | null };
        if (!addonsExists || !addonsExists.table) {
            await qi.createTable('addons', {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                name: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                base_price: {
                    type: DataTypes.DECIMAL(10, 2),
                    allowNull: true,
                },
                tax_rate: {
                    type: DataTypes.DECIMAL(5, 4),
                    allowNull: true,
                },
                is_active: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: true,
                },
                createdAt: {
                    type: DataTypes.DATE,
                    allowNull: false,
                    defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
                },
                updatedAt: {
                    type: DataTypes.DATE,
                    allowNull: false,
                    defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
                },
            }, { transaction });
        }
        log('addons checked');
        // Product Addons table
        const productAddonsExists = (await qi.sequelize.query(
            `SELECT to_regclass('public.product_addons') as table`,
            { plain: true, transaction, type: QueryTypes.SELECT },
        )) as { table?: string | null };
        if (!productAddonsExists || !productAddonsExists.table) {
            await qi.createTable('product_addons', {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                product_id: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: 'products',
                        key: 'id',
                    },
                    onUpdate: 'CASCADE',
                    onDelete: 'CASCADE',
                },
                addon_id: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: 'addons',
                        key: 'id',
                    },
                    onUpdate: 'CASCADE',
                    onDelete: 'CASCADE',
                },
                max_per_attendee: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                },
                price_override: {
                    type: DataTypes.DECIMAL(10, 2),
                    allowNull: true,
                },
                sort_order: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 0,
                },
                createdAt: {
                    type: DataTypes.DATE,
                    allowNull: false,
                    defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
                },
                updatedAt: {
                    type: DataTypes.DATE,
                    allowNull: false,
                    defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
                },
            }, {
                transaction,
                uniqueKeys: {
                    product_addons_product_addon_unique: {
                        fields: ['product_id', 'addon_id'],
                    },
                },
            });
            await qi.addIndex('product_addons', ['product_id'], {
                name: 'product_addons_product_id_idx',
                transaction,
            });
            await qi.addIndex('product_addons', ['addon_id'], {
                name: 'product_addons_addon_id_idx',
                transaction,
            });
        }
        log('product_addons checked');
        // Counter channel metrics
        const metricsExists = (await qi.sequelize.query(
            `SELECT to_regclass('public.counter_channel_metrics') as table`,
            { plain: true, transaction, type: QueryTypes.SELECT },
        )) as { table?: string | null };
        if (!metricsExists || !metricsExists.table) {
            await qi.createTable('counter_channel_metrics', {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                counter_id: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: 'counters',
                        key: 'id',
                    },
                    onUpdate: 'CASCADE',
                    onDelete: 'CASCADE',
                },
                channel_id: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: 'channels',
                        key: 'id',
                    },
                    onUpdate: 'CASCADE',
                    onDelete: 'RESTRICT',
                },
                kind: {
                    type: DataTypes.ENUM('people', 'addon'),
                    allowNull: false,
                },
                addon_id: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    references: {
                        model: 'addons',
                        key: 'id',
                    },
                    onUpdate: 'CASCADE',
                    onDelete: 'SET NULL',
                },
                tally_type: {
                    type: DataTypes.ENUM('booked', 'attended'),
                    allowNull: false,
                },
                period: {
                    type: DataTypes.ENUM('before_cutoff', 'after_cutoff'),
                    allowNull: true,
                },
                qty: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 0,
                },
                createdAt: {
                    type: DataTypes.DATE,
                    allowNull: false,
                    defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
                },
                updatedAt: {
                    type: DataTypes.DATE,
                    allowNull: false,
                    defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
                },
            }, { transaction });
            await qi.addIndex('counter_channel_metrics', ['counter_id'], {
                name: 'counter_channel_metrics_counter_id_idx',
                transaction,
            });
            await qi.addIndex('counter_channel_metrics', ['channel_id'], {
                name: 'counter_channel_metrics_channel_id_idx',
                transaction,
            });
            await qi.addIndex('counter_channel_metrics', ['addon_id'], {
                name: 'counter_channel_metrics_addon_id_idx',
                transaction,
            });
            await qi.sequelize.query(`ALTER TABLE "counter_channel_metrics"
          ADD CONSTRAINT counter_channel_metrics_addon_required
          CHECK (
            (kind = 'addon' AND addon_id IS NOT NULL) OR
            (kind = 'people' AND addon_id IS NULL)
          )`, { transaction });
            await qi.sequelize.query(`ALTER TABLE "counter_channel_metrics"
          ADD CONSTRAINT counter_channel_metrics_period_rule
          CHECK (
            (tally_type = 'booked' AND period IS NOT NULL) OR
            (tally_type = 'attended' AND period IS NULL)
          )`, { transaction });
            await qi.sequelize.query(`ALTER TABLE "counter_channel_metrics"
          ADD CONSTRAINT counter_channel_metrics_qty_non_negative
          CHECK (qty >= 0)`, { transaction });
            await qi.sequelize.query(`CREATE UNIQUE INDEX counter_channel_metrics_cell_unique
          ON "counter_channel_metrics" (
            counter_id,
            channel_id,
            kind,
            COALESCE(addon_id, 0),
            tally_type,
            COALESCE(period, '-')
          )`, { transaction });
        }
        log('counter_channel_metrics checked');
        log('committing');
        await transaction.commit();
        log('committed');
    }
    catch (error) {
        log('error', error);
        await transaction.rollback();
        throw error;
    }
}
export async function down({ context }: MigrationParams): Promise<void> {
    const qi = context;
    const transaction = await qi.sequelize.transaction();
    try {
        // Drop unique index and constraints from counter_channel_metrics
        await qi.sequelize.query('DROP INDEX IF EXISTS counter_channel_metrics_cell_unique', { transaction });
        await qi.sequelize.query('ALTER TABLE "counter_channel_metrics" DROP CONSTRAINT IF EXISTS counter_channel_metrics_addon_required', { transaction });
        await qi.sequelize.query('ALTER TABLE "counter_channel_metrics" DROP CONSTRAINT IF EXISTS counter_channel_metrics_period_rule', { transaction });
        await qi.sequelize.query('ALTER TABLE "counter_channel_metrics" DROP CONSTRAINT IF EXISTS counter_channel_metrics_qty_non_negative', { transaction });
        await qi.dropTable('counter_channel_metrics', { transaction });
        await qi.dropTable('product_addons', { transaction });
        await qi.dropTable('addons', { transaction });
        // CounterUsers revert
        await qi.removeIndex('counterUsers', 'counter_users_counter_user_unique', { transaction }).catch(() => { });
        const counterUsersDesc = (await qi.describeTable('counterUsers')) as Record<string, unknown>;
        if ('role' in counterUsersDesc) {
            await qi.removeColumn('counterUsers', 'role', { transaction });
            await qi.sequelize.query('DROP TYPE IF EXISTS "enum_counterUsers_role"', { transaction });
        }
        if ('counter_id' in counterUsersDesc) {
            await qi.renameColumn('counterUsers', 'counter_id', 'counterId', { transaction });
        }
        if ('user_id' in counterUsersDesc) {
            await qi.renameColumn('counterUsers', 'user_id', 'userId', { transaction });
        }
        // Counters revert
        await qi.removeIndex('counters', 'counters_date_unique', { transaction }).catch(() => { });
        await qi.removeIndex('counters', 'counters_product_id_idx', { transaction }).catch(() => { });
        await qi.removeIndex('counters', 'counters_user_id_idx', { transaction }).catch(() => { });
        const countersDesc = (await (qi as any).describeTable('counters', { transaction })) as Record<string, unknown>;
        if ('notes' in countersDesc) {
            await qi.removeColumn('counters', 'notes', { transaction });
        }
        if ('product_id' in countersDesc) {
            await qi.removeColumn('counters', 'product_id', { transaction });
        }
        if ('status' in countersDesc) {
            await qi.removeColumn('counters', 'status', { transaction });
            await qi.sequelize.query('DROP TYPE IF EXISTS "enum_counters_status"', { transaction });
        }
        await qi.changeColumn('counters', 'date', {
            type: DataTypes.DATE,
            allowNull: false,
        }, { transaction });
        if (!('total' in countersDesc)) {
            await qi.addColumn('counters', 'total', {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false,
                defaultValue: 0,
            }, { transaction });
        }
        const countersDescAfter = (await (qi as any).describeTable('counters', { transaction })) as Record<string, unknown>;
        if ('date' in countersDescAfter) {
            await qi.renameColumn('counters', 'date', 'date', { transaction });
        }
        // Drop ENUM types from metrics
        await qi.sequelize.query('DROP TYPE IF EXISTS "enum_counter_channel_metrics_kind"', { transaction });
        await qi.sequelize.query('DROP TYPE IF EXISTS "enum_counter_channel_metrics_tally_type"', { transaction });
        await qi.sequelize.query('DROP TYPE IF EXISTS "enum_counter_channel_metrics_period"', { transaction });
        await transaction.commit();
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
}
