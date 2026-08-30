export class StaffPayoutReceiptSafeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'StaffPayoutReceiptSafeError';
    this.status = status;
    this.code = code;
  }
}

export const staffPayoutReceiptInputError = (message: string): StaffPayoutReceiptSafeError =>
  new StaffPayoutReceiptSafeError(400, 'STAFF_PAYOUT_RECEIPT_INVALID_INPUT', message);

export const staffPayoutReceiptStateError = (
  status: 404 | 409,
  message: string,
): StaffPayoutReceiptSafeError =>
  new StaffPayoutReceiptSafeError(status, 'STAFF_PAYOUT_RECEIPT_UNAVAILABLE', message);
