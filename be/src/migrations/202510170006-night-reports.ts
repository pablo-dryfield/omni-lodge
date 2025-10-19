import type { QueryInterface } from 'sequelize';
import { DataTypes, QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    const nightReportsExists = (await qi.sequelize.query(
      `SELECT to_regclass('public.night_reports') as table`,
      { plain: true, transaction, type: QueryTypes.SELECT },
    )) as { table?: string | null };

    if (!nightReportsExists?.table) {
      await qi.createTable('night_reports', {
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
        leader_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        activity_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        status: {
          type: DataTypes.ENUM('draft', 'submitted'),
          allowNull: false,
          defaultValue: 'draft',
        },
        notes: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        submitted_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        reassigned_by_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_by: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        updated_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      }, { transaction });
      await qi.addIndex('night_reports', ['counter_id'], {
        name: 'night_reports_counter_id_unique',
        unique: true,
        transaction,
      });
      await qi.addIndex('night_reports', ['leader_id'], {
        name: 'night_reports_leader_id_idx',
        transaction,
      });
      await qi.addIndex('night_reports', ['activity_date'], {
        name: 'night_reports_activity_date_idx',
        transaction,
      });
      await qi.addIndex('night_reports', ['status'], {
        name: 'night_reports_status_idx',
        transaction,
      });
    }

    const venuesExists = (await qi.sequelize.query(
      `SELECT to_regclass('public.night_report_venues') as table`,
      { plain: true, transaction, type: QueryTypes.SELECT },
    )) as { table?: string | null };

    if (!venuesExists?.table) {
      await qi.createTable('night_report_venues', {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        report_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'night_reports',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        order_index: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        venue_name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        total_people: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        is_open_bar: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        normal_count: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        cocktails_count: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        brunch_count: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      }, { transaction });

      await qi.addIndex('night_report_venues', ['report_id', 'order_index'], {
        name: 'night_report_venues_report_order_unique',
        unique: true,
        transaction,
      });

      await qi.addIndex('night_report_venues', ['report_id'], {
        name: 'night_report_venues_report_id_idx',
        transaction,
      });

      await qi.sequelize.query(`
        ALTER TABLE "night_report_venues"
        ADD CONSTRAINT night_report_venues_order_positive
        CHECK (order_index >= 1)
      `, { transaction });

      await qi.sequelize.query(`
        ALTER TABLE "night_report_venues"
        ADD CONSTRAINT night_report_venues_people_non_negative
        CHECK (total_people >= 0)
      `, { transaction });

      await qi.sequelize.query(`
        ALTER TABLE "night_report_venues"
        ADD CONSTRAINT night_report_venues_open_bar_consistency
        CHECK (
          (is_open_bar = true AND normal_count IS NOT NULL AND cocktails_count IS NOT NULL AND brunch_count IS NOT NULL)
          OR
          (is_open_bar = false AND normal_count IS NULL AND cocktails_count IS NULL AND brunch_count IS NULL)
        )
      `, { transaction });

      await qi.sequelize.query(`
        ALTER TABLE "night_report_venues"
        ADD CONSTRAINT night_report_venues_open_bar_counts_non_negative
        CHECK (
          (normal_count IS NULL OR normal_count >= 0) AND
          (cocktails_count IS NULL OR cocktails_count >= 0) AND
          (brunch_count IS NULL OR brunch_count >= 0)
        )
      `, { transaction });
    }

    const photosExists = (await qi.sequelize.query(
      `SELECT to_regclass('public.night_report_photos') as table`,
      { plain: true, transaction, type: QueryTypes.SELECT },
    )) as { table?: string | null };

    if (!photosExists?.table) {
      await qi.createTable('night_report_photos', {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        report_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'night_reports',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        uploader_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        storage_path: {
          type: DataTypes.STRING(512),
          allowNull: false,
        },
        original_name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        mime_type: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        file_size: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        captured_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      }, { transaction });

      await qi.addIndex('night_report_photos', ['report_id'], {
        name: 'night_report_photos_report_id_idx',
        transaction,
      });

      await qi.addIndex('night_report_photos', ['uploader_id'], {
        name: 'night_report_photos_uploader_id_idx',
        transaction,
      });

      await qi.sequelize.query(`
        ALTER TABLE "night_report_photos"
        ADD CONSTRAINT night_report_photos_file_size_positive
        CHECK (file_size > 0)
      `, { transaction });
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.removeIndex('night_report_photos', 'night_report_photos_report_id_idx', { transaction }).catch(() => { });
    await qi.removeIndex('night_report_photos', 'night_report_photos_uploader_id_idx', { transaction }).catch(() => { });
    await qi.sequelize.query('ALTER TABLE "night_report_photos" DROP CONSTRAINT IF EXISTS night_report_photos_file_size_positive', { transaction });
    await qi.dropTable('night_report_photos', { transaction }).catch(() => { });

    await qi.removeIndex('night_report_venues', 'night_report_venues_report_order_unique', { transaction }).catch(() => { });
    await qi.removeIndex('night_report_venues', 'night_report_venues_report_id_idx', { transaction }).catch(() => { });
    await qi.sequelize.query('ALTER TABLE "night_report_venues" DROP CONSTRAINT IF EXISTS night_report_venues_order_positive', { transaction });
    await qi.sequelize.query('ALTER TABLE "night_report_venues" DROP CONSTRAINT IF EXISTS night_report_venues_people_non_negative', { transaction });
    await qi.sequelize.query('ALTER TABLE "night_report_venues" DROP CONSTRAINT IF EXISTS night_report_venues_open_bar_consistency', { transaction });
    await qi.sequelize.query('ALTER TABLE "night_report_venues" DROP CONSTRAINT IF EXISTS night_report_venues_open_bar_counts_non_negative', { transaction });
    await qi.dropTable('night_report_venues', { transaction }).catch(() => { });

    await qi.removeIndex('night_reports', 'night_reports_counter_id_unique', { transaction }).catch(() => { });
    await qi.removeIndex('night_reports', 'night_reports_leader_id_idx', { transaction }).catch(() => { });
    await qi.removeIndex('night_reports', 'night_reports_activity_date_idx', { transaction }).catch(() => { });
    await qi.removeIndex('night_reports', 'night_reports_status_idx', { transaction }).catch(() => { });
    await qi.dropTable('night_reports', { transaction }).catch(() => { });
    await qi.sequelize.query('DROP TYPE IF EXISTS "enum_night_reports_status"', { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
