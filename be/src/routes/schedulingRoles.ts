export const MANAGER_ROLES = ['owner', 'admin', 'administrator', 'manager', 'assistant-manager', 'assistant_manager'] as const;

const normalizeSchedulingRole = (value: string): string => {
  const collapsed = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (collapsed === 'administrator') {
    return 'admin';
  }
  if (collapsed === 'assistantmanager' || collapsed === 'assistmanager') {
    return 'assistant-manager';
  }
  return collapsed;
};

const NORMALIZED_MANAGER_ROLES = new Set(MANAGER_ROLES.map(normalizeSchedulingRole));

export const isSchedulingManagerRole = (...values: Array<string | null | undefined>): boolean =>
  values.some((value) => Boolean(value && NORMALIZED_MANAGER_ROLES.has(normalizeSchedulingRole(value))));
