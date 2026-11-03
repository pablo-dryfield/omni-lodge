// These are authorization invariants, not administrator-tunable operating limits.
// Additional protected business objects are configurable through Control Panel.
export const WORKSPACE_CONTROL_OBJECTS = [
  'config_keys',
  'config_values',
  'config_history',
  'config_seed_runs',
  'users',
  'userTypes',
  'user_type_product_types',
  'roleModulePermissions',
  'rolePagePermissions',
  'moduleActions',
  'actions',
  'modules',
  'pages',
  'audit_logs',
  'finance_audit_logs',
  'migration_audit_runs',
  'migration_audit_steps',
  'SequelizeMeta',
  'sequelize_meta',
] as const;
