export const canLoadHomeExternalRefunds = (accessReady: boolean, canView: boolean, role: string | null | undefined): boolean =>
  accessReady && canView && ['admin', 'administrator', 'owner', 'manager', 'assistantmanager', 'assistmanager']
    .includes(String(role ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ''));
