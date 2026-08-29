export type StaffPayoutDrivePermissionSummary = {
  id?: string | null;
  type?: string | null;
  role?: string | null;
  emailAddress?: string | null;
  domain?: string | null;
  deleted?: boolean | null;
};

export type StaffPayoutDriveIdentity = {
  emailAddress: string | null;
  permissionId: string | null;
};

export function describeUnsafeStaffPayoutDrivePermission(
  permission: StaffPayoutDrivePermissionSummary,
  identity: StaffPayoutDriveIdentity,
): string | null {
  if (permission.deleted) {
    return null;
  }

  const type = permission.type?.trim().toLowerCase() ?? '';
  if (type === 'anyone' || type === 'domain') {
    return `${type} ${permission.role ?? 'access'}`;
  }
  const permissionEmail = permission.emailAddress?.trim().toLowerCase() ?? null;
  const identityEmail = identity.emailAddress?.trim().toLowerCase() ?? null;
  const belongsToOauthAccount = Boolean(
    (identity.permissionId && permission.id === identity.permissionId)
      || (identityEmail && permissionEmail === identityEmail),
  );
  if (permission.role === 'owner' || belongsToOauthAccount) {
    return null;
  }

  const principal = permissionEmail ?? permission.domain?.trim() ?? permission.id?.trim() ?? 'unknown principal';
  return `${type || 'unknown'} ${permission.role ?? 'access'} for ${principal}`;
}
