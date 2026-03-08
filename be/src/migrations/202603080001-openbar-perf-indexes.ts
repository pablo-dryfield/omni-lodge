import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const INDEXES: Array<{ table: string; fields: string[]; name: string }> = [
  {
    table: 'open_bar_sessions',
    fields: ['business_date', 'status'],
    name: 'open_bar_sessions_business_date_status_idx',
  },
  {
    table: 'open_bar_sessions',
    fields: ['business_date', 'id'],
    name: 'open_bar_sessions_business_date_id_idx',
  },
  {
    table: 'open_bar_drink_issues',
    fields: ['session_id', 'issued_at'],
    name: 'open_bar_drink_issues_session_issued_at_idx',
  },
  {
    table: 'open_bar_inventory_movements',
    fields: ['issue_id', 'movement_type'],
    name: 'open_bar_inventory_movements_issue_type_idx',
  },
  {
    table: 'open_bar_inventory_movements',
    fields: ['ingredient_id'],
    name: 'open_bar_inventory_movements_ingredient_idx',
  },
  {
    table: 'open_bar_session_memberships',
    fields: ['user_id', 'is_active'],
    name: 'open_bar_session_memberships_user_active_idx',
  },
  {
    table: 'venues',
    fields: ['is_active', 'allows_open_bar', 'sort_order'],
    name: 'venues_open_bar_visibility_sort_idx',
  },
];

export async function up({ context }: MigrationParams): Promise<void> {
  for (const index of INDEXES) {
    // Ignore duplicates when environments already contain these indexes.
    await context.addIndex(index.table, index.fields, { name: index.name }).catch(() => {});
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  for (const index of INDEXES) {
    await context.removeIndex(index.table, index.name).catch(() => {});
  }
}

