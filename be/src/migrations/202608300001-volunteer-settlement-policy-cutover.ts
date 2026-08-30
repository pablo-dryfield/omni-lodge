import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

/**
 * Corrects the original seed cutover without replacing rule rows. Keeping the
 * same rule ids matters because closed staff payout snapshots retain those ids
 * as immutable settlement evidence.
 */
export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `UPDATE compensation_settlement_rules AS rule
       SET effective_start = DATE '2026-08-01',
           updated_at = NOW()
       WHERE rule.target_scope = 'staff_type'
         AND lower(rule.staff_type) = 'volunteer'
         AND rule.effective_start = DATE '2026-09-01'
         AND rule.effective_end IS NULL
         AND rule.is_active = TRUE
         AND rule.created_by IS NULL
         AND rule.updated_by IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM compensation_settlement_rules AS other
           WHERE other.id <> rule.id
             AND other.is_active = TRUE
             AND other.target_scope = rule.target_scope
             AND other.staff_type IS NOT DISTINCT FROM rule.staff_type
             AND other.user_id IS NOT DISTINCT FROM rule.user_id
             AND other.match_kind = rule.match_kind
             AND other.component_id IS NOT DISTINCT FROM rule.component_id
             AND other.match_key IS NOT DISTINCT FROM rule.match_key
             AND other.effective_start = DATE '2026-08-01'
             AND other.effective_end IS NOT DISTINCT FROM rule.effective_end
         )
         AND (
           (
             rule.match_kind = 'default'
             AND rule.component_id IS NULL
             AND rule.match_key IS NULL
             AND rule.destination = 'volunteer_fund'
             AND rule.fund_id = (
               SELECT fund.id
               FROM volunteer_funds AS fund
               WHERE lower(fund.slug) = 'volunteer-fund'
               ORDER BY fund.id ASC
               LIMIT 1
             )
           )
           OR (
             rule.match_kind = 'component_category'
             AND rule.component_id IS NULL
             AND rule.match_key = 'review'
             AND rule.destination = 'staff_vendor'
             AND rule.fund_id IS NULL
           )
           OR (
             rule.match_kind = 'system_source'
             AND rule.component_id IS NULL
             AND rule.match_key IN (
               'promotion_sales',
               'reimbursement',
               'carry_forward_personal'
             )
             AND rule.destination = 'staff_vendor'
             AND rule.fund_id IS NULL
           )
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
      `UPDATE compensation_settlement_rules AS rule
       SET effective_start = DATE '2026-09-01',
           updated_at = NOW()
       WHERE rule.target_scope = 'staff_type'
         AND lower(rule.staff_type) = 'volunteer'
         AND rule.effective_start = DATE '2026-08-01'
         AND rule.effective_end IS NULL
         AND rule.is_active = TRUE
         AND rule.created_by IS NULL
         AND rule.updated_by IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM compensation_settlement_rules AS other
           WHERE other.id <> rule.id
             AND other.is_active = TRUE
             AND other.target_scope = rule.target_scope
             AND other.staff_type IS NOT DISTINCT FROM rule.staff_type
             AND other.user_id IS NOT DISTINCT FROM rule.user_id
             AND other.match_kind = rule.match_kind
             AND other.component_id IS NOT DISTINCT FROM rule.component_id
             AND other.match_key IS NOT DISTINCT FROM rule.match_key
             AND other.effective_start = DATE '2026-09-01'
             AND other.effective_end IS NOT DISTINCT FROM rule.effective_end
         )
         AND (
           (
             rule.match_kind = 'default'
             AND rule.component_id IS NULL
             AND rule.match_key IS NULL
             AND rule.destination = 'volunteer_fund'
             AND rule.fund_id = (
               SELECT fund.id
               FROM volunteer_funds AS fund
               WHERE lower(fund.slug) = 'volunteer-fund'
               ORDER BY fund.id ASC
               LIMIT 1
             )
           )
           OR (
             rule.match_kind = 'component_category'
             AND rule.component_id IS NULL
             AND rule.match_key = 'review'
             AND rule.destination = 'staff_vendor'
             AND rule.fund_id IS NULL
           )
           OR (
             rule.match_kind = 'system_source'
             AND rule.component_id IS NULL
             AND rule.match_key IN (
               'promotion_sales',
               'reimbursement',
               'carry_forward_personal'
             )
             AND rule.destination = 'staff_vendor'
             AND rule.fund_id IS NULL
           )
         );`,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
