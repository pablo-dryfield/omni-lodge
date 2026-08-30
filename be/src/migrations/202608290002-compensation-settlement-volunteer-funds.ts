import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `CREATE TABLE volunteer_funds (
        id SERIAL PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        slug VARCHAR(180) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        description TEXT NULL,
        linked_account_id INTEGER NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
        expense_category_id INTEGER NULL REFERENCES finance_categories(id) ON DELETE RESTRICT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT volunteer_funds_slug_nonempty_ck CHECK (btrim(slug) <> ''),
        CONSTRAINT volunteer_funds_currency_ck CHECK (currency ~ '^[A-Z]{3}$')
      );

      CREATE UNIQUE INDEX volunteer_funds_slug_uidx
        ON volunteer_funds (lower(slug));
      CREATE INDEX volunteer_funds_active_name_idx
        ON volunteer_funds (is_active, name);`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE TABLE compensation_settlement_rules (
        id SERIAL PRIMARY KEY,
        target_scope VARCHAR(24) NOT NULL
          CHECK (target_scope IN ('global', 'staff_type', 'user')),
        staff_type VARCHAR(64) NULL,
        user_id INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT,
        match_kind VARCHAR(32) NOT NULL
          CHECK (match_kind IN ('default', 'component', 'component_category', 'system_source')),
        component_id INTEGER NULL REFERENCES compensation_components(id) ON DELETE RESTRICT,
        match_key VARCHAR(180) NULL,
        destination VARCHAR(32) NOT NULL
          CHECK (destination IN ('staff_vendor', 'volunteer_fund', 'excluded')),
        fund_id INTEGER NULL REFERENCES volunteer_funds(id) ON DELETE RESTRICT,
        effective_start DATE NULL,
        effective_end DATE NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT compensation_settlement_rule_target_ck CHECK (
          (target_scope = 'global' AND staff_type IS NULL AND user_id IS NULL)
          OR (target_scope = 'staff_type' AND staff_type IS NOT NULL AND btrim(staff_type) <> '' AND user_id IS NULL)
          OR (target_scope = 'user' AND staff_type IS NULL AND user_id IS NOT NULL)
        ),
        CONSTRAINT compensation_settlement_rule_match_ck CHECK (
          (match_kind = 'default' AND component_id IS NULL AND match_key IS NULL)
          OR (match_kind = 'component' AND component_id IS NOT NULL AND match_key IS NULL)
          OR (match_kind IN ('component_category', 'system_source')
              AND component_id IS NULL AND match_key IS NOT NULL AND btrim(match_key) <> '')
        ),
        CONSTRAINT compensation_settlement_rule_destination_ck CHECK (
          (destination = 'volunteer_fund' AND fund_id IS NOT NULL)
          OR (destination IN ('staff_vendor', 'excluded') AND fund_id IS NULL)
        ),
        CONSTRAINT compensation_settlement_rule_dates_ck CHECK (
          effective_start IS NULL OR effective_end IS NULL OR effective_end >= effective_start
        )
      );

      CREATE INDEX compensation_settlement_rules_lookup_idx
        ON compensation_settlement_rules
          (is_active, target_scope, staff_type, user_id, match_kind, component_id, match_key);
      CREATE INDEX compensation_settlement_rules_effective_idx
        ON compensation_settlement_rules (effective_start, effective_end);
      CREATE UNIQUE INDEX compensation_settlement_rules_exact_active_uidx
        ON compensation_settlement_rules (
          target_scope,
          COALESCE(staff_type, ''),
          COALESCE(user_id, 0),
          match_kind,
          COALESCE(component_id, 0),
          COALESCE(match_key, ''),
          COALESCE(effective_start, '-infinity'::date),
          COALESCE(effective_end, 'infinity'::date)
        )
        WHERE is_active;`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE TABLE volunteer_fund_entries (
        id BIGSERIAL PRIMARY KEY,
        fund_id INTEGER NOT NULL REFERENCES volunteer_funds(id) ON DELETE RESTRICT,
        entry_type VARCHAR(24) NOT NULL
          CHECK (entry_type IN ('allocation', 'spend', 'adjustment', 'reversal')),
        amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
        currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
        entry_date DATE NOT NULL,
        period_start DATE NULL,
        period_end DATE NULL,
        description TEXT NOT NULL,
        attributed_staff_user_id INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT,
        compensation_component_id INTEGER NULL REFERENCES compensation_components(id) ON DELETE RESTRICT,
        source_kind VARCHAR(64) NULL,
        source_reference VARCHAR(255) NULL,
        attribution_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        finance_transaction_id INTEGER NULL REFERENCES finance_transactions(id) ON DELETE RESTRICT,
        idempotency_key VARCHAR(180) NULL,
        reversal_of_entry_id BIGINT NULL REFERENCES volunteer_fund_entries(id) ON DELETE RESTRICT,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT volunteer_fund_entry_reversal_ck CHECK (
          (entry_type = 'reversal' AND reversal_of_entry_id IS NOT NULL)
          OR (entry_type <> 'reversal' AND reversal_of_entry_id IS NULL)
        ),
        CONSTRAINT volunteer_fund_entry_spend_sign_ck CHECK (
          entry_type <> 'spend' OR amount_minor < 0
        ),
        CONSTRAINT volunteer_fund_entry_spend_finance_ck CHECK (
          entry_type <> 'spend' OR finance_transaction_id IS NOT NULL
        ),
        CONSTRAINT volunteer_fund_entry_period_ck CHECK (
          (period_start IS NULL AND period_end IS NULL)
          OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start)
        )
      );

      CREATE INDEX volunteer_fund_entries_fund_date_idx
        ON volunteer_fund_entries (fund_id, entry_date, id);
      CREATE INDEX volunteer_fund_entries_staff_idx
        ON volunteer_fund_entries (attributed_staff_user_id, entry_date)
        WHERE attributed_staff_user_id IS NOT NULL;
      CREATE INDEX volunteer_fund_entries_component_idx
        ON volunteer_fund_entries (compensation_component_id, entry_date)
        WHERE compensation_component_id IS NOT NULL;
      CREATE INDEX volunteer_fund_entries_staff_period_idx
        ON volunteer_fund_entries
          (fund_id, attributed_staff_user_id, period_start, period_end)
        WHERE attributed_staff_user_id IS NOT NULL AND period_start IS NOT NULL;
      CREATE UNIQUE INDEX volunteer_fund_entries_idempotency_uidx
        ON volunteer_fund_entries (fund_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE UNIQUE INDEX volunteer_fund_entries_reversal_uidx
        ON volunteer_fund_entries (reversal_of_entry_id)
        WHERE reversal_of_entry_id IS NOT NULL;
      CREATE UNIQUE INDEX volunteer_fund_entries_finance_transaction_uidx
        ON volunteer_fund_entries (finance_transaction_id)
        WHERE finance_transaction_id IS NOT NULL;`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE OR REPLACE FUNCTION prevent_volunteer_fund_entry_mutation()
       RETURNS trigger AS $$
       BEGIN
         RAISE EXCEPTION 'volunteer_fund_entries is append-only; create a reversal instead';
       END;
       $$ LANGUAGE plpgsql;

       CREATE TRIGGER volunteer_fund_entries_append_only_trigger
       BEFORE UPDATE OR DELETE ON volunteer_fund_entries
       FOR EACH ROW EXECUTE FUNCTION prevent_volunteer_fund_entry_mutation();`,
      { transaction },
    );

    await context.sequelize.query(
      `INSERT INTO volunteer_funds (
         name, slug, currency, description, is_active, created_at, updated_at
       )
       VALUES (
         'Volunteer Fund',
         'volunteer-fund',
         'PLN',
         'Organization-controlled fund for volunteer activities and purchases.',
         TRUE,
         NOW(),
         NOW()
       )
       ON CONFLICT DO NOTHING;`,
      { transaction },
    );

    await context.sequelize.query(
      `INSERT INTO compensation_settlement_rules (
         target_scope, staff_type, match_kind, component_id, match_key,
         destination, fund_id, effective_start, is_active, created_at, updated_at
       )
       SELECT
         seed.target_scope,
         seed.staff_type,
         seed.match_kind,
         NULL,
         seed.match_key,
         seed.destination,
         CASE WHEN seed.destination = 'volunteer_fund' THEN fund.id ELSE NULL END,
         seed.effective_start,
         TRUE,
         NOW(),
         NOW()
       FROM volunteer_funds fund
       CROSS JOIN (
         VALUES
           ('global', NULL, 'default', NULL, 'staff_vendor', NULL::date),
           ('staff_type', 'volunteer', 'default', NULL, 'volunteer_fund', DATE '2026-08-01'),
           ('staff_type', 'volunteer', 'component_category', 'review', 'staff_vendor', DATE '2026-08-01'),
           ('staff_type', 'volunteer', 'system_source', 'promotion_sales', 'staff_vendor', DATE '2026-08-01'),
           ('staff_type', 'volunteer', 'system_source', 'reimbursement', 'staff_vendor', DATE '2026-08-01'),
           ('staff_type', 'volunteer', 'system_source', 'carry_forward_personal', 'staff_vendor', DATE '2026-08-01')
       ) AS seed(target_scope, staff_type, match_kind, match_key, destination, effective_start)
       WHERE fund.slug = 'volunteer-fund'
         AND NOT EXISTS (
           SELECT 1
           FROM compensation_settlement_rules existing
           WHERE existing.target_scope = seed.target_scope
             AND existing.staff_type IS NOT DISTINCT FROM seed.staff_type
             AND existing.user_id IS NULL
             AND existing.match_kind = seed.match_kind
             AND existing.component_id IS NULL
             AND existing.match_key IS NOT DISTINCT FROM seed.match_key
             AND existing.effective_start IS NOT DISTINCT FROM seed.effective_start
             AND existing.is_active = TRUE
         );`,
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `DO $$
       BEGIN
         IF EXISTS (SELECT 1 FROM volunteer_fund_entries LIMIT 1) THEN
           RAISE EXCEPTION 'Cannot remove the volunteer fund ledger while entries exist';
         END IF;
       END $$;`,
      { transaction },
    );
    await context.sequelize.query(
      `DROP TRIGGER IF EXISTS volunteer_fund_entries_append_only_trigger ON volunteer_fund_entries;
       DROP FUNCTION IF EXISTS prevent_volunteer_fund_entry_mutation();
       DROP TABLE IF EXISTS volunteer_fund_entries;
       DROP TABLE IF EXISTS compensation_settlement_rules;
       DROP TABLE IF EXISTS volunteer_funds;`,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
