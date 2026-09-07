import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const BACKUP_TABLE = 'staff_payout_reimbursement_ledger_repair_202609070008';

const reimbursementClassificationSql = (collectionAlias: string, financeAlias: string): string => `COALESCE((
  ${financeAlias}.meta->>'settlementKind' = 'reimbursement'
  OR ${financeAlias}.meta->'excludeFromStaffPayoutLedger' = 'true'::jsonb
  OR LOWER(BTRIM(COALESCE(${financeAlias}.meta->>'lineLabel', ''))) LIKE '%reimbursement%'
  OR LOWER(BTRIM(COALESCE(${financeAlias}.description, ''))) LIKE '%reimbursement%'
  OR LOWER(BTRIM(COALESCE(${collectionAlias}.note, ''))) LIKE '%reimbursement%'
), FALSE)`;

const createBackupTableSql = `
  CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
    ledger_id INTEGER PRIMARY KEY
      REFERENCES staff_payout_ledgers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    staff_user_id INTEGER NOT NULL,
    range_start DATE NOT NULL,
    range_end DATE NOT NULL,
    currency_code VARCHAR(3) NOT NULL,
    original_opening_balance_minor INTEGER NOT NULL,
    original_due_amount_minor INTEGER NOT NULL,
    original_paid_amount_minor INTEGER NOT NULL,
    original_closing_balance_minor INTEGER NOT NULL,
    original_settlement_snapshot JSONB NULL,
    original_updated_at TIMESTAMPTZ NULL,
    direct_reimbursement_minor INTEGER NOT NULL DEFAULT 0,
    repaired_opening_balance_minor INTEGER NULL,
    repaired_due_amount_minor INTEGER NULL,
    repaired_paid_amount_minor INTEGER NULL,
    repaired_closing_balance_minor INTEGER NULL,
    repaired_settlement_snapshot JSONB NULL,
    repaired_updated_at TIMESTAMPTZ NULL,
    repaired_at TIMESTAMPTZ NULL
  );
`;

const createClassifiedCollectionsSql = `
  CREATE TEMP TABLE tmp_staff_payout_classified_collections
  ON COMMIT DROP
  AS
  SELECT collection.id,
         collection.staff_profile_id,
         collection.direction,
         UPPER(BTRIM(collection.currency_code)) AS currency_code,
         collection.amount_minor,
         collection.range_start,
         collection.range_end,
         collection.finance_transaction_id,
         ${reimbursementClassificationSql('collection', 'finance_transaction')}
           AS is_reimbursement
    FROM staff_payout_collection_logs AS collection
    LEFT JOIN finance_transactions AS finance_transaction
      ON finance_transaction.id = collection.finance_transaction_id;
`;

const validateSourceRowsSql = `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
        FROM tmp_staff_payout_classified_collections AS collection
       WHERE collection.direction = 'payable'
         AND collection.is_reimbursement
         AND collection.amount_minor <= 0
    ) THEN
      RAISE EXCEPTION
        'Staff payout reimbursement ledger repair found a non-positive reimbursement collection.';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM tmp_staff_payout_classified_collections AS collection
       WHERE collection.direction = 'payable'
         AND collection.is_reimbursement
         AND NOT EXISTS (
           SELECT 1
             FROM staff_payout_ledgers AS ledger
            WHERE ledger.staff_user_id = collection.staff_profile_id
              AND ledger.range_start = collection.range_start
              AND ledger.range_end = collection.range_end
              AND UPPER(BTRIM(ledger.currency_code)) = collection.currency_code
         )
    ) THEN
      RAISE EXCEPTION
        'Staff payout reimbursement ledger repair found a reimbursement without an exact payout ledger.';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM staff_payout_ledgers AS ledger
       WHERE ledger.settlement_snapshot IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM tmp_staff_payout_classified_collections AS collection
            WHERE collection.direction = 'payable'
              AND collection.is_reimbursement
              AND collection.staff_profile_id = ledger.staff_user_id
              AND collection.range_start = ledger.range_start
              AND collection.range_end = ledger.range_end
              AND collection.currency_code = UPPER(BTRIM(ledger.currency_code))
         )
         AND (
           JSONB_TYPEOF(ledger.settlement_snapshot) IS DISTINCT FROM 'object'
           OR JSONB_TYPEOF(ledger.settlement_snapshot->'sources') IS DISTINCT FROM 'array'
         )
    ) THEN
      RAISE EXCEPTION
        'Staff payout reimbursement ledger repair found an invalid settlement snapshot.';
    END IF;
  END
  $$;
`;

const createDirectRepairsSql = `
  CREATE TEMP TABLE tmp_staff_payout_direct_reimbursement_repairs
  ON COMMIT DROP
  AS
  WITH collection_totals AS (
    SELECT ledger.id AS ledger_id,
           SUM(collection.amount_minor)::BIGINT AS reimbursement_minor
      FROM staff_payout_ledgers AS ledger
      JOIN tmp_staff_payout_classified_collections AS collection
        ON collection.staff_profile_id = ledger.staff_user_id
       AND collection.range_start = ledger.range_start
       AND collection.range_end = ledger.range_end
       AND collection.currency_code = UPPER(BTRIM(ledger.currency_code))
       AND collection.direction = 'payable'
       AND collection.is_reimbursement
     GROUP BY ledger.id
  ),
  snapshot_sources AS (
    SELECT ledger.id AS ledger_id,
           source.value AS source
      FROM staff_payout_ledgers AS ledger
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
        CASE
          WHEN JSONB_TYPEOF(ledger.settlement_snapshot) = 'object'
           AND JSONB_TYPEOF(ledger.settlement_snapshot->'sources') = 'array'
            THEN ledger.settlement_snapshot->'sources'
          ELSE '[]'::jsonb
        END
      ) AS source(value)
     WHERE source.value->>'sourceKey' = 'reimbursement'
  ),
  snapshot_totals AS (
    SELECT source.ledger_id,
           SUM((source.source->>'grossAmountMinor')::BIGINT)::BIGINT
             AS reimbursement_minor
      FROM snapshot_sources AS source
     WHERE source.source->>'destination' = 'staff_vendor'
     GROUP BY source.ledger_id
  )
  SELECT ledger.id AS ledger_id,
         ledger.staff_user_id,
         ledger.range_start,
         ledger.range_end,
         UPPER(BTRIM(ledger.currency_code)) AS currency_code,
         COALESCE(collection.reimbursement_minor, 0)::BIGINT
           AS collection_reimbursement_minor,
         COALESCE(snapshot.reimbursement_minor, 0)::BIGINT
           AS snapshot_reimbursement_minor,
         CASE
           -- A populated snapshot is the immutable due authority. The fixed
           -- application deliberately keeps reimbursements out of that
           -- snapshot while retaining their Finance collection rows, so a
           -- collection alone must not make an already-clean ledger eligible.
           WHEN ledger.settlement_snapshot IS NOT NULL
             THEN COALESCE(snapshot.reimbursement_minor, 0)
           -- Ledgers predating snapshots can only be classified from their
           -- matching immutable payout collection.
           ELSE COALESCE(collection.reimbursement_minor, 0)
         END::BIGINT AS direct_reimbursement_minor
    FROM staff_payout_ledgers AS ledger
    LEFT JOIN collection_totals AS collection ON collection.ledger_id = ledger.id
    LEFT JOIN snapshot_totals AS snapshot ON snapshot.ledger_id = ledger.id
   WHERE CASE
           WHEN ledger.settlement_snapshot IS NOT NULL
             THEN COALESCE(snapshot.reimbursement_minor, 0) <> 0
           ELSE COALESCE(collection.reimbursement_minor, 0) <> 0
         END
     AND NOT EXISTS (
       SELECT 1
         FROM ${BACKUP_TABLE} AS prior_repair
        WHERE prior_repair.ledger_id = ledger.id
     );
`;

const validateDirectRepairsSql = `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
        FROM staff_payout_ledgers AS ledger
        CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
          CASE
            WHEN JSONB_TYPEOF(ledger.settlement_snapshot) = 'object'
             AND JSONB_TYPEOF(ledger.settlement_snapshot->'sources') = 'array'
              THEN ledger.settlement_snapshot->'sources'
            ELSE '[]'::jsonb
          END
        ) AS source(value)
       WHERE source.value->>'sourceKey' = 'reimbursement'
         AND (
           source.value->>'destination' <> 'staff_vendor'
           OR COALESCE(source.value->>'grossAmountMinor', '') !~ '^[1-9][0-9]*$'
           OR LENGTH(source.value->>'grossAmountMinor') > 10
         )
    ) THEN
      RAISE EXCEPTION
        'Staff payout reimbursement ledger repair found an invalid reimbursement snapshot source.';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM tmp_staff_payout_direct_reimbursement_repairs AS repair
       WHERE repair.direct_reimbursement_minor IS NULL
          OR repair.direct_reimbursement_minor <= 0
          OR repair.direct_reimbursement_minor > 2147483647
    ) THEN
      RAISE EXCEPTION
        'Staff payout reimbursement ledger repair found an invalid reimbursement authority.';
    END IF;
  END
  $$;
`;

const createAffectedUsersSql = `
  CREATE TEMP TABLE tmp_staff_payout_repair_users
  ON COMMIT DROP
  AS
  SELECT repair.staff_user_id,
         MIN(repair.range_start) AS first_range_start
    FROM tmp_staff_payout_direct_reimbursement_repairs AS repair
   GROUP BY repair.staff_user_id;
`;

const validateCarryChainsSql = `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
        FROM tmp_staff_payout_repair_users AS affected
        JOIN LATERAL (
          SELECT COUNT(DISTINCT UPPER(BTRIM(chain.currency_code))) AS currency_count
            FROM staff_payout_ledgers AS chain
           WHERE chain.staff_user_id = affected.staff_user_id
             AND (
               chain.range_start >= affected.first_range_start
               OR chain.id = (
                 SELECT previous.id
                   FROM staff_payout_ledgers AS previous
                  WHERE previous.staff_user_id = affected.staff_user_id
                    AND previous.range_start < affected.first_range_start
                  ORDER BY previous.range_start DESC, previous.id DESC
                  LIMIT 1
               )
             )
        ) AS currencies ON TRUE
       WHERE currencies.currency_count > 1
    ) THEN
      RAISE EXCEPTION
        'Staff payout reimbursement ledger repair cannot cross payout ledger currencies.';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM (
          SELECT chain.staff_user_id,
                 chain.range_start,
                 LAG(chain.range_end) OVER (
                   PARTITION BY chain.staff_user_id
                   ORDER BY chain.range_start, chain.id
                 ) AS previous_range_end
            FROM staff_payout_ledgers AS chain
            JOIN tmp_staff_payout_repair_users AS affected
              ON affected.staff_user_id = chain.staff_user_id
             AND chain.range_start >= affected.first_range_start
        ) AS ordered
       WHERE ordered.previous_range_end >= ordered.range_start
    ) THEN
      RAISE EXCEPTION
        'Staff payout reimbursement ledger repair found overlapping payout ledger ranges.';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM staff_payout_ledgers AS ledger
        JOIN tmp_staff_payout_repair_users AS affected
          ON affected.staff_user_id = ledger.staff_user_id
         AND ledger.range_start >= affected.first_range_start
        JOIN affiliate_payout_logs AS affiliate
          ON affiliate.affiliate_user_id = ledger.staff_user_id
         AND UPPER(BTRIM(affiliate.currency_code)) = UPPER(BTRIM(ledger.currency_code))
         AND affiliate.range_end >= ledger.range_start
         AND affiliate.range_start <= ledger.range_end
       WHERE affiliate.range_start < ledger.range_start
          OR affiliate.range_end > ledger.range_end
    ) THEN
      RAISE EXCEPTION
        'Staff payout reimbursement ledger repair found an affiliate payout spanning ledger periods.';
    END IF;
  END
  $$;
`;

const backupCarryChainsSql = `
  INSERT INTO ${BACKUP_TABLE} (
    ledger_id,
    staff_user_id,
    range_start,
    range_end,
    currency_code,
    original_opening_balance_minor,
    original_due_amount_minor,
    original_paid_amount_minor,
    original_closing_balance_minor,
    original_settlement_snapshot,
    original_updated_at,
    direct_reimbursement_minor
  )
  SELECT ledger.id,
         ledger.staff_user_id,
         ledger.range_start,
         ledger.range_end,
         UPPER(BTRIM(ledger.currency_code)),
         ledger.opening_balance_minor,
         ledger.due_amount_minor,
         ledger.paid_amount_minor,
         ledger.closing_balance_minor,
         ledger.settlement_snapshot,
         ledger.updated_at,
         COALESCE(repair.direct_reimbursement_minor, 0)::INTEGER
    FROM staff_payout_ledgers AS ledger
    JOIN tmp_staff_payout_repair_users AS affected
      ON affected.staff_user_id = ledger.staff_user_id
     AND ledger.range_start >= affected.first_range_start
    LEFT JOIN tmp_staff_payout_direct_reimbursement_repairs AS repair
      ON repair.ledger_id = ledger.id
  ON CONFLICT (ledger_id) DO NOTHING;
`;

const createProposedLedgerValuesSql = `
  CREATE TEMP TABLE tmp_staff_payout_proposed_ledger_values
  ON COMMIT DROP
  AS
  WITH collection_paid AS (
    SELECT backup.ledger_id,
           COALESCE(
             SUM(collection.amount_minor) FILTER (
               WHERE collection.direction = 'payable'
                 AND NOT collection.is_reimbursement
             ),
             0
           )::BIGINT AS amount_minor
      FROM ${BACKUP_TABLE} AS backup
      LEFT JOIN tmp_staff_payout_classified_collections AS collection
        ON collection.staff_profile_id = backup.staff_user_id
       AND collection.range_start = backup.range_start
       AND collection.range_end = backup.range_end
       AND collection.currency_code = backup.currency_code
     WHERE backup.repaired_at IS NULL
     GROUP BY backup.ledger_id
  ),
  affiliate_paid AS (
    SELECT backup.ledger_id,
           COALESCE(SUM(affiliate.amount_minor), 0)::BIGINT AS amount_minor
      FROM ${BACKUP_TABLE} AS backup
      LEFT JOIN affiliate_payout_logs AS affiliate
        ON affiliate.affiliate_user_id = backup.staff_user_id
       AND UPPER(BTRIM(affiliate.currency_code)) = backup.currency_code
       AND affiliate.range_start >= backup.range_start
       AND affiliate.range_end <= backup.range_end
       AND NOT EXISTS (
         SELECT 1
           FROM tmp_staff_payout_classified_collections AS collection
          WHERE collection.staff_profile_id = backup.staff_user_id
            AND collection.range_start = backup.range_start
            AND collection.range_end = backup.range_end
            AND collection.currency_code = backup.currency_code
            AND collection.direction = 'payable'
            AND NOT collection.is_reimbursement
            AND collection.finance_transaction_id = affiliate.finance_transaction_id
       )
     WHERE backup.repaired_at IS NULL
     GROUP BY backup.ledger_id
  )
  SELECT backup.ledger_id,
         backup.staff_user_id,
         backup.range_start,
         backup.range_end,
         (
           backup.original_due_amount_minor::BIGINT
           - backup.direct_reimbursement_minor::BIGINT
         ) AS due_amount_minor,
         (collection.amount_minor + affiliate.amount_minor)::BIGINT AS paid_amount_minor,
         CASE
           WHEN backup.direct_reimbursement_minor = 0
             OR backup.original_settlement_snapshot IS NULL
             THEN backup.original_settlement_snapshot
           ELSE JSONB_SET(
             backup.original_settlement_snapshot,
             '{sources}',
             COALESCE(
               (
                 SELECT JSONB_AGG(source.value ORDER BY source.ordinality)
                   FROM JSONB_ARRAY_ELEMENTS(
                     backup.original_settlement_snapshot->'sources'
                   ) WITH ORDINALITY AS source(value, ordinality)
                  WHERE COALESCE(source.value->>'sourceKey', '') <> 'reimbursement'
               ),
               '[]'::jsonb
             ),
             FALSE
           )
         END AS settlement_snapshot
    FROM ${BACKUP_TABLE} AS backup
    JOIN collection_paid AS collection ON collection.ledger_id = backup.ledger_id
    JOIN affiliate_paid AS affiliate ON affiliate.ledger_id = backup.ledger_id
   WHERE backup.repaired_at IS NULL;
`;

const createCalculatedCarryChainsSql = `
  CREATE TEMP TABLE tmp_staff_payout_calculated_ledger_values
  ON COMMIT DROP
  AS
  WITH chain_bases AS (
    SELECT affected.staff_user_id,
           COALESCE(
             (
               SELECT previous.closing_balance_minor
                 FROM staff_payout_ledgers AS previous
                WHERE previous.staff_user_id = affected.staff_user_id
                  AND previous.range_start < affected.first_range_start
                ORDER BY previous.range_start DESC, previous.id DESC
                LIMIT 1
             ),
             0
           )::BIGINT AS base_balance_minor
      FROM tmp_staff_payout_repair_users AS affected
  ),
  ordered AS (
    SELECT proposed.*,
           base.base_balance_minor
      FROM tmp_staff_payout_proposed_ledger_values AS proposed
      JOIN chain_bases AS base ON base.staff_user_id = proposed.staff_user_id
  )
  SELECT ordered.ledger_id,
         ordered.due_amount_minor,
         ordered.paid_amount_minor,
         ordered.settlement_snapshot,
         ordered.base_balance_minor
           + COALESCE(
             SUM(ordered.due_amount_minor - ordered.paid_amount_minor) OVER (
               PARTITION BY ordered.staff_user_id
               ORDER BY ordered.range_start, ordered.ledger_id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ),
             0
           ) AS opening_balance_minor,
         ordered.base_balance_minor
           + SUM(ordered.due_amount_minor - ordered.paid_amount_minor) OVER (
             PARTITION BY ordered.staff_user_id
             ORDER BY ordered.range_start, ordered.ledger_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS closing_balance_minor
    FROM ordered;
`;

const validateCalculatedValuesSql = `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
        FROM tmp_staff_payout_calculated_ledger_values AS calculated
       WHERE calculated.opening_balance_minor NOT BETWEEN -2147483648 AND 2147483647
          OR calculated.due_amount_minor NOT BETWEEN -2147483648 AND 2147483647
          OR calculated.paid_amount_minor NOT BETWEEN -2147483648 AND 2147483647
          OR calculated.closing_balance_minor NOT BETWEEN -2147483648 AND 2147483647
          OR calculated.paid_amount_minor < 0
    ) THEN
      RAISE EXCEPTION
        'Staff payout reimbursement ledger repair exceeds safe ledger currency limits.';
    END IF;
  END
  $$;
`;

const updateLedgersSql = `
  UPDATE staff_payout_ledgers AS ledger
     SET opening_balance_minor = calculated.opening_balance_minor::INTEGER,
         due_amount_minor = calculated.due_amount_minor::INTEGER,
         paid_amount_minor = calculated.paid_amount_minor::INTEGER,
         closing_balance_minor = calculated.closing_balance_minor::INTEGER,
         settlement_snapshot = calculated.settlement_snapshot,
         updated_at = NOW()
    FROM tmp_staff_payout_calculated_ledger_values AS calculated
   WHERE ledger.id = calculated.ledger_id;
`;

const finishBackupSql = `
  UPDATE ${BACKUP_TABLE} AS backup
     SET repaired_opening_balance_minor = ledger.opening_balance_minor,
         repaired_due_amount_minor = ledger.due_amount_minor,
         repaired_paid_amount_minor = ledger.paid_amount_minor,
         repaired_closing_balance_minor = ledger.closing_balance_minor,
         repaired_settlement_snapshot = ledger.settlement_snapshot,
         repaired_updated_at = ledger.updated_at,
         repaired_at = NOW()
    FROM staff_payout_ledgers AS ledger
   WHERE ledger.id = backup.ledger_id
     AND backup.repaired_at IS NULL;
`;

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(createBackupTableSql, { transaction });
    await context.sequelize.query(
      `LOCK TABLE staff_payout_ledgers,
                  staff_payout_collection_logs,
                  finance_transactions,
                  affiliate_payout_logs,
                  ${BACKUP_TABLE}
         IN SHARE ROW EXCLUSIVE MODE;`,
      { transaction },
    );
    await context.sequelize.query(createClassifiedCollectionsSql, { transaction });
    await context.sequelize.query(validateSourceRowsSql, { transaction });
    await context.sequelize.query(createDirectRepairsSql, { transaction });
    await context.sequelize.query(validateDirectRepairsSql, { transaction });
    await context.sequelize.query(createAffectedUsersSql, { transaction });
    await context.sequelize.query(validateCarryChainsSql, { transaction });
    await context.sequelize.query(backupCarryChainsSql, { transaction });
    await context.sequelize.query(createProposedLedgerValuesSql, { transaction });
    await context.sequelize.query(createCalculatedCarryChainsSql, { transaction });
    await context.sequelize.query(validateCalculatedValuesSql, { transaction });
    await context.sequelize.query(updateLedgersSql, { transaction });
    await context.sequelize.query(finishBackupSql, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

type BackupPresenceRow = { backup_table: string | null };

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    const [rows] = await context.sequelize.query(
      `SELECT TO_REGCLASS('public.${BACKUP_TABLE}')::text AS backup_table;`,
      { transaction },
    );
    const backupTable = (rows as BackupPresenceRow[])[0]?.backup_table ?? null;
    if (!backupTable) {
      await transaction.commit();
      return;
    }

    await context.sequelize.query(
      `LOCK TABLE staff_payout_ledgers, ${BACKUP_TABLE}
         IN SHARE ROW EXCLUSIVE MODE;`,
      { transaction },
    );
    await context.sequelize.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1
             FROM ${BACKUP_TABLE} AS backup
             LEFT JOIN staff_payout_ledgers AS ledger ON ledger.id = backup.ledger_id
            WHERE ledger.id IS NULL
               OR backup.repaired_at IS NULL
               OR ledger.opening_balance_minor IS DISTINCT FROM backup.repaired_opening_balance_minor
               OR ledger.due_amount_minor IS DISTINCT FROM backup.repaired_due_amount_minor
               OR ledger.paid_amount_minor IS DISTINCT FROM backup.repaired_paid_amount_minor
               OR ledger.closing_balance_minor IS DISTINCT FROM backup.repaired_closing_balance_minor
               OR ledger.settlement_snapshot IS DISTINCT FROM backup.repaired_settlement_snapshot
               OR ledger.updated_at IS DISTINCT FROM backup.repaired_updated_at
         ) THEN
           RAISE EXCEPTION
             'Cannot undo staff payout reimbursement ledger repair after later ledger changes.';
         END IF;
       END
       $$;`,
      { transaction },
    );
    await context.sequelize.query(
      `UPDATE staff_payout_ledgers AS ledger
          SET opening_balance_minor = backup.original_opening_balance_minor,
              due_amount_minor = backup.original_due_amount_minor,
              paid_amount_minor = backup.original_paid_amount_minor,
              closing_balance_minor = backup.original_closing_balance_minor,
              settlement_snapshot = backup.original_settlement_snapshot,
              updated_at = backup.original_updated_at
         FROM ${BACKUP_TABLE} AS backup
        WHERE ledger.id = backup.ledger_id;`,
      { transaction },
    );
    await context.sequelize.query(`DROP TABLE ${BACKUP_TABLE};`, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

type VerificationRow = {
  backup_count: string | number;
  direct_repair_count: string | number;
  unfinished_count: string | number;
  direct_due_mismatch_count: string | number;
  equation_mismatch_count: string | number;
  continuity_mismatch_count: string | number;
  reimbursement_snapshot_count: string | number;
  canonical_paid_mismatch_count: string | number;
  unrepaired_collection_count: string | number;
};

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(
    `WITH classified_collections AS (
       SELECT collection.*,
              UPPER(BTRIM(collection.currency_code)) AS normalized_currency_code,
              ${reimbursementClassificationSql('collection', 'finance_transaction')}
                AS is_reimbursement
         FROM staff_payout_collection_logs AS collection
         LEFT JOIN finance_transactions AS finance_transaction
           ON finance_transaction.id = collection.finance_transaction_id
     ),
     canonical_collection_paid AS (
       SELECT backup.ledger_id,
              COALESCE(
                SUM(collection.amount_minor) FILTER (
                  WHERE collection.direction = 'payable'
                    AND NOT collection.is_reimbursement
                ),
                0
              )::BIGINT AS amount_minor
         FROM ${BACKUP_TABLE} AS backup
         LEFT JOIN classified_collections AS collection
           ON collection.staff_profile_id = backup.staff_user_id
          AND collection.range_start = backup.range_start
          AND collection.range_end = backup.range_end
          AND collection.normalized_currency_code = backup.currency_code
        GROUP BY backup.ledger_id
     ),
     canonical_affiliate_paid AS (
       SELECT backup.ledger_id,
              COALESCE(SUM(affiliate.amount_minor), 0)::BIGINT AS amount_minor
         FROM ${BACKUP_TABLE} AS backup
         LEFT JOIN affiliate_payout_logs AS affiliate
           ON affiliate.affiliate_user_id = backup.staff_user_id
          AND UPPER(BTRIM(affiliate.currency_code)) = backup.currency_code
          AND affiliate.range_start >= backup.range_start
          AND affiliate.range_end <= backup.range_end
          AND NOT EXISTS (
            SELECT 1
              FROM classified_collections AS collection
             WHERE collection.staff_profile_id = backup.staff_user_id
               AND collection.range_start = backup.range_start
               AND collection.range_end = backup.range_end
               AND collection.normalized_currency_code = backup.currency_code
               AND collection.direction = 'payable'
               AND NOT collection.is_reimbursement
               AND collection.finance_transaction_id = affiliate.finance_transaction_id
          )
        GROUP BY backup.ledger_id
     )
     SELECT
       (SELECT COUNT(*) FROM ${BACKUP_TABLE}) AS backup_count,
       (SELECT COUNT(*) FROM ${BACKUP_TABLE} WHERE direct_reimbursement_minor > 0)
         AS direct_repair_count,
       (SELECT COUNT(*) FROM ${BACKUP_TABLE} WHERE repaired_at IS NULL)
         AS unfinished_count,
       (
         SELECT COUNT(*)
           FROM ${BACKUP_TABLE} AS backup
           JOIN staff_payout_ledgers AS ledger ON ledger.id = backup.ledger_id
          WHERE ledger.due_amount_minor
                <> backup.original_due_amount_minor - backup.direct_reimbursement_minor
       ) AS direct_due_mismatch_count,
       (
         SELECT COUNT(*)
           FROM ${BACKUP_TABLE} AS backup
           JOIN staff_payout_ledgers AS ledger ON ledger.id = backup.ledger_id
          WHERE ledger.closing_balance_minor
                <> ledger.opening_balance_minor + ledger.due_amount_minor - ledger.paid_amount_minor
       ) AS equation_mismatch_count,
       (
         SELECT COUNT(*)
           FROM ${BACKUP_TABLE} AS backup
           JOIN staff_payout_ledgers AS ledger ON ledger.id = backup.ledger_id
           LEFT JOIN LATERAL (
             SELECT previous.closing_balance_minor
               FROM staff_payout_ledgers AS previous
              WHERE previous.staff_user_id = ledger.staff_user_id
                AND (
                  previous.range_start < ledger.range_start
                  OR (
                    previous.range_start = ledger.range_start
                    AND previous.id < ledger.id
                  )
                )
              ORDER BY previous.range_start DESC, previous.id DESC
              LIMIT 1
           ) AS previous ON TRUE
          WHERE ledger.opening_balance_minor <> COALESCE(previous.closing_balance_minor, 0)
       ) AS continuity_mismatch_count,
       (
         SELECT COUNT(*)
           FROM ${BACKUP_TABLE} AS backup
           JOIN staff_payout_ledgers AS ledger ON ledger.id = backup.ledger_id
           CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
             CASE
               WHEN JSONB_TYPEOF(ledger.settlement_snapshot) = 'object'
                AND JSONB_TYPEOF(ledger.settlement_snapshot->'sources') = 'array'
                 THEN ledger.settlement_snapshot->'sources'
               ELSE '[]'::jsonb
             END
           ) AS source(value)
          WHERE backup.direct_reimbursement_minor > 0
            AND source.value->>'sourceKey' = 'reimbursement'
       ) AS reimbursement_snapshot_count,
       (
         SELECT COUNT(*)
           FROM ${BACKUP_TABLE} AS backup
           JOIN staff_payout_ledgers AS ledger ON ledger.id = backup.ledger_id
           JOIN canonical_collection_paid AS collection ON collection.ledger_id = backup.ledger_id
           JOIN canonical_affiliate_paid AS affiliate ON affiliate.ledger_id = backup.ledger_id
          WHERE ledger.paid_amount_minor <> collection.amount_minor + affiliate.amount_minor
       ) AS canonical_paid_mismatch_count,
       (
         SELECT COUNT(*)
           FROM classified_collections AS collection
           JOIN staff_payout_ledgers AS ledger
             ON ledger.staff_user_id = collection.staff_profile_id
            AND ledger.range_start = collection.range_start
            AND ledger.range_end = collection.range_end
            AND UPPER(BTRIM(ledger.currency_code)) = collection.normalized_currency_code
           LEFT JOIN ${BACKUP_TABLE} AS backup ON backup.ledger_id = ledger.id
          WHERE collection.direction = 'payable'
            AND collection.is_reimbursement
            AND (
              ledger.settlement_snapshot IS NULL
              OR EXISTS (
                SELECT 1
                  FROM JSONB_ARRAY_ELEMENTS(
                    CASE
                      WHEN JSONB_TYPEOF(ledger.settlement_snapshot) = 'object'
                       AND JSONB_TYPEOF(ledger.settlement_snapshot->'sources') = 'array'
                        THEN ledger.settlement_snapshot->'sources'
                      ELSE '[]'::jsonb
                    END
                  ) AS source(value)
                 WHERE source.value->>'sourceKey' = 'reimbursement'
              )
            )
            AND COALESCE(backup.direct_reimbursement_minor, 0) <= 0
       ) AS unrepaired_collection_count;`,
  );

  const row = (rows as VerificationRow[])[0];
  const details = {
    backupCount: Number(row?.backup_count ?? 0),
    directRepairCount: Number(row?.direct_repair_count ?? 0),
    unfinishedCount: Number(row?.unfinished_count ?? 0),
    directDueMismatchCount: Number(row?.direct_due_mismatch_count ?? 0),
    equationMismatchCount: Number(row?.equation_mismatch_count ?? 0),
    continuityMismatchCount: Number(row?.continuity_mismatch_count ?? 0),
    reimbursementSnapshotCount: Number(row?.reimbursement_snapshot_count ?? 0),
    canonicalPaidMismatchCount: Number(row?.canonical_paid_mismatch_count ?? 0),
    unrepairedCollectionCount: Number(row?.unrepaired_collection_count ?? 0),
  };
  return {
    ok:
      details.unfinishedCount === 0
      && details.directDueMismatchCount === 0
      && details.equationMismatchCount === 0
      && details.continuityMismatchCount === 0
      && details.reimbursementSnapshotCount === 0
      && details.canonicalPaidMismatchCount === 0
      && details.unrepairedCollectionCount === 0,
    details,
  };
}
