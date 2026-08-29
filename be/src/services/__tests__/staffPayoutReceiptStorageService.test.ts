import { describeUnsafeStaffPayoutDrivePermission } from '../staffPayoutReceiptDrivePrivacy.js';

const identity = {
  emailAddress: 'drive-owner@example.com',
  permissionId: 'oauth-permission-id',
};

describe('staff payout receipt Drive privacy', () => {
  it.each(['anyone', 'domain'])(
    'rejects %s access even for a dedicated evidence folder',
    (type) => {
      expect(describeUnsafeStaffPayoutDrivePermission(
        { type, role: 'reader', domain: type === 'domain' ? 'example.com' : null },
        identity,
      )).not.toBeNull();
    },
  );

  it('rejects explicitly shared users or groups when owner-only evidence storage is required', () => {
    expect(describeUnsafeStaffPayoutDrivePermission(
      { type: 'group', role: 'reader', emailAddress: 'finance-managers@example.com' },
      identity,
    )).not.toBeNull();
  });

  it('allows only the OAuth account and owner', () => {
    expect(describeUnsafeStaffPayoutDrivePermission(
      { id: 'oauth-permission-id', type: 'user', role: 'writer' },
      identity,
    )).toBeNull();
    expect(describeUnsafeStaffPayoutDrivePermission(
      { id: 'owner-id', type: 'user', role: 'owner', emailAddress: 'owner@example.com' },
      identity,
    )).toBeNull();
    expect(describeUnsafeStaffPayoutDrivePermission(
      { id: 'another-user', type: 'user', role: 'reader', emailAddress: 'staff@example.com' },
      identity,
    )).not.toBeNull();
    expect(describeUnsafeStaffPayoutDrivePermission(
      { id: 'staff-group', type: 'group', role: 'reader', emailAddress: 'staff@example.com' },
      identity,
    )).not.toBeNull();
  });

  it('ignores deleted permissions', () => {
    expect(describeUnsafeStaffPayoutDrivePermission(
      { type: 'anyone', role: 'reader', deleted: true },
      identity,
    )).toBeNull();
  });
});
