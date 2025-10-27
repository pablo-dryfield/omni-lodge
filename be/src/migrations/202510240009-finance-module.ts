import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable('finance_accounts', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
        unique: true,
      },
      type: {
        type: DataTypes.ENUM('cash', 'bank', 'stripe', 'revolut', 'other'),
        allowNull: false,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
      },
      opening_balance_minor: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await qi.createTable('finance_categories', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      kind: {
        type: DataTypes.ENUM('income', 'expense'),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      parent_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'finance_categories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await qi.createTable('finance_vendors', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      tax_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      default_category_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'finance_categories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await qi.createTable('finance_clients', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      tax_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      default_category_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'finance_categories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await qi.createTable('finance_files', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      original_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      mime_type: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      size_bytes: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      drive_file_id: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
      },
      drive_web_view_link: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      sha256: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      uploaded_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      uploaded_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, { transaction });

    await qi.createTable('finance_transactions', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      kind: {
        type: DataTypes.ENUM('income', 'expense', 'transfer', 'refund'),
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      account_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'finance_accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
      },
      amount_minor: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      fx_rate: {
        type: DataTypes.DECIMAL(18, 6),
        allowNull: false,
        defaultValue: 1,
      },
      base_amount_minor: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      category_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'finance_categories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      counterparty_type: {
        type: DataTypes.ENUM('vendor', 'client', 'none'),
        allowNull: false,
        defaultValue: 'none',
      },
      counterparty_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      payment_method: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('planned', 'approved', 'paid', 'reimbursed', 'void'),
        allowNull: false,
        defaultValue: 'planned',
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      tags: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      meta: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      invoice_file_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'finance_files',
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
      approved_by: {
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

    await qi.addIndex('finance_transactions', ['account_id'], { transaction, name: 'finance_transactions_account_idx' });
    await qi.addIndex('finance_transactions', ['date'], { transaction, name: 'finance_transactions_date_idx' });
    await qi.addIndex('finance_transactions', ['status'], { transaction, name: 'finance_transactions_status_idx' });

    await qi.createTable('finance_recurring_rules', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      kind: {
        type: DataTypes.ENUM('income', 'expense'),
        allowNull: false,
      },
      template_json: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      frequency: {
        type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly'),
        allowNull: false,
      },
      interval: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      by_month_day: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      timezone: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      next_run_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_run_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'paused'),
        allowNull: false,
        defaultValue: 'active',
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

    await qi.addIndex('finance_recurring_rules', ['status'], { transaction, name: 'finance_recurring_rules_status_idx' });
    await qi.addIndex('finance_recurring_rules', ['next_run_date'], { transaction, name: 'finance_recurring_rules_next_run_idx' });

    await qi.createTable('finance_management_requests', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      type: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      target_entity: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      target_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      requested_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      status: {
        type: DataTypes.ENUM('open', 'approved', 'returned', 'rejected'),
        allowNull: false,
        defaultValue: 'open',
      },
      manager_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      decision_note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      priority: {
        type: DataTypes.ENUM('low', 'normal', 'high'),
        allowNull: false,
        defaultValue: 'normal',
      },
      due_at: {
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

    await qi.addIndex('finance_management_requests', ['status'], { transaction, name: 'finance_management_requests_status_idx' });
    await qi.addIndex('finance_management_requests', ['priority'], { transaction, name: 'finance_management_requests_priority_idx' });

    await qi.createTable('finance_budgets', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      period: {
        type: DataTypes.STRING(7),
        allowNull: false,
      },
      category_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'finance_categories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      amount_minor: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
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

    await qi.addIndex('finance_budgets', ['period', 'category_id'], {
      transaction,
      name: 'finance_budgets_period_category_uq',
      unique: true,
    });

    await qi.createTable('finance_audit_logs', {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      entity: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      entity_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      action: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      changes: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      performed_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, { transaction });

    await qi.addIndex('finance_audit_logs', ['entity', 'entity_id'], {
      transaction,
      name: 'finance_audit_logs_entity_idx',
    });
    await qi.addIndex('finance_audit_logs', ['occurred_at'], {
      transaction,
      name: 'finance_audit_logs_occurred_idx',
    });

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
    await qi.dropTable('finance_audit_logs', { transaction }).catch(() => {});
    await qi.removeIndex('finance_budgets', 'finance_budgets_period_category_uq', { transaction }).catch(() => {});
    await qi.dropTable('finance_budgets', { transaction }).catch(() => {});
    await qi.removeIndex('finance_management_requests', 'finance_management_requests_status_idx', { transaction }).catch(() => {});
    await qi.removeIndex('finance_management_requests', 'finance_management_requests_priority_idx', { transaction }).catch(() => {});
    await qi.dropTable('finance_management_requests', { transaction }).catch(() => {});
    await qi.removeIndex('finance_recurring_rules', 'finance_recurring_rules_status_idx', { transaction }).catch(() => {});
    await qi.removeIndex('finance_recurring_rules', 'finance_recurring_rules_next_run_idx', { transaction }).catch(() => {});
    await qi.dropTable('finance_recurring_rules', { transaction }).catch(() => {});
    await qi.removeIndex('finance_transactions', 'finance_transactions_account_idx', { transaction }).catch(() => {});
    await qi.removeIndex('finance_transactions', 'finance_transactions_date_idx', { transaction }).catch(() => {});
    await qi.removeIndex('finance_transactions', 'finance_transactions_status_idx', { transaction }).catch(() => {});
    await qi.dropTable('finance_transactions', { transaction }).catch(() => {});
    await qi.dropTable('finance_files', { transaction }).catch(() => {});
    await qi.dropTable('finance_clients', { transaction }).catch(() => {});
    await qi.dropTable('finance_vendors', { transaction }).catch(() => {});
    await qi.dropTable('finance_categories', { transaction }).catch(() => {});
    await qi.dropTable('finance_accounts', { transaction }).catch(() => {});

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  await context.sequelize.query('DROP TYPE IF EXISTS "enum_finance_accounts_type";');
  await context.sequelize.query('DROP TYPE IF EXISTS "enum_finance_categories_kind";');
  await context.sequelize.query('DROP TYPE IF EXISTS "enum_finance_transactions_kind";');
  await context.sequelize.query('DROP TYPE IF EXISTS "enum_finance_transactions_counterparty_type";');
  await context.sequelize.query('DROP TYPE IF EXISTS "enum_finance_transactions_status";');
  await context.sequelize.query('DROP TYPE IF EXISTS "enum_finance_recurring_rules_kind";');
  await context.sequelize.query('DROP TYPE IF EXISTS "enum_finance_recurring_rules_frequency";');
  await context.sequelize.query('DROP TYPE IF EXISTS "enum_finance_recurring_rules_status";');
  await context.sequelize.query('DROP TYPE IF EXISTS "enum_finance_management_requests_status";');
  await context.sequelize.query('DROP TYPE IF EXISTS "enum_finance_management_requests_priority";');
}

