export type NightReportStatus = 'draft' | 'submitted';

export type NightReportSummary = {
  id: number;
  activityDate: string;
  leaderName: string;
  status: NightReportStatus;
  venuesCount: number;
  totalPeople: number;
  counterId: number;
  productId: number | null;
  productName: string | null;
  requiresCostReconciliation: boolean;
  costReconciliation: {
    required: boolean;
    resolved: boolean;
    resolution: 'not_required' | 'linked_costs' | 'no_extra_cost_confirmed' | 'unresolved';
    linkedCostCount: number;
    noExtraCostConfirmed: boolean;
    noExtraCostConfirmedAt: string | null;
    noExtraCostConfirmedBy: {
      id: number;
      fullName: string;
    } | null;
  };
};

export type NightReportLeader = {
  id: number;
  fullName: string;
};

export type NightReportCounterRef = {
  id: number;
  date: string;
};

export type NightReportVenue = {
  id: number;
  orderIndex: number;
  venueName: string;
  venueId: number | null;
  totalPeople: number;
  isOpenBar: boolean;
  normalCount: number | null;
  cocktailsCount: number | null;
  brunchCount: number | null;
  compensationTermId: number | null;
  compensationType: 'open_bar' | 'commission' | null;
  compensationDirection: 'payable' | 'receivable' | null;
  rateApplied: number | string | null;
  rateUnit: 'per_person' | 'flat' | null;
  payoutAmount: number | string | null;
  currencyCode: string | null;
};

export type NightReportPhoto = {
  id: number;
  originalName: string;
  mimeType: string;
  fileSize: number;
  capturedAt: string | null;
  downloadUrl: string;
};

export type NightReportCost = {
  id: number;
  date: string;
  serviceDate: string | null;
  currency: string;
  amountMinor: number;
  status: 'planned' | 'approved' | 'awaiting_reimbursement' | 'paid' | 'reimbursed' | 'void';
  paymentMethod: string | null;
  description: string | null;
  nightReportId: number | null;
  productId: number | null;
  productName: string | null;
  linkOrigin: 'created' | 'linked';
  linkedReport: {
    id: number;
    activityDate: string;
    status: NightReportStatus;
    leaderName: string | null;
  } | null;
  accountId: number | null;
  accountName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  vendorId: number | null;
  vendorName: string | null;
  invoiceFileId: number | null;
  invoiceReferenceCount: number;
  receiptGroupKey: string | null;
  receiptTotalMinor: number | null;
  receiptCurrency: string | null;
  receiptAllocationNote: string | null;
  receiptLineOrder: number | null;
  receiptItems: Array<{
    description: string | null;
    quantity: number;
    amountMinor: number;
  }>;
  invoiceFile: {
    id: number;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    driveFileId: string;
    driveWebViewLink: string;
    sha256: string;
    uploadedBy: number;
    uploadedAt: string;
  } | null;
};

export type NightReportFinanceSummary = {
  revenueAmount: number;
  revenueCurrency: string;
  revenueItems: Array<{
    id: string;
    label: string;
    subtitle: string | null;
    amount: number;
    currency: string;
  }>;
  linkedCostAmount: number;
  openBarCostAmount: number;
  staffPayoutAmount: number;
  totalCostAmount: number;
  costCurrency: string;
  costItems: Array<{
    id: string;
    kind: 'linked_cost' | 'open_bar' | 'staff_payout';
    label: string;
    subtitle: string | null;
    amount: number;
    currency: string;
  }>;
  earningsAmount: number;
  earningsCurrency: string;
};

export type NightReportLinkableCost = {
  id: number;
  date: string;
  serviceDate: string | null;
  currency: string;
  amountMinor: number;
  status: 'planned' | 'approved' | 'awaiting_reimbursement' | 'paid' | 'reimbursed' | 'void';
  paymentMethod: string | null;
  description: string | null;
  nightReportId: number | null;
  productId: number | null;
  productName: string | null;
  linkOrigin: 'created' | 'linked';
  linkedReport: {
    id: number;
    activityDate: string;
    status: NightReportStatus;
    leaderName: string | null;
  } | null;
  accountId: number | null;
  accountName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  vendorId: number | null;
  vendorName: string | null;
  invoiceFileId: number | null;
  invoiceReferenceCount: number;
  receiptGroupKey: string | null;
  receiptTotalMinor: number | null;
  receiptCurrency: string | null;
  receiptAllocationNote: string | null;
  receiptLineOrder: number | null;
  receiptItems: Array<{
    description: string | null;
    quantity: number;
    amountMinor: number;
  }>;
  invoiceFile: {
    id: number;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    driveFileId: string;
    driveWebViewLink: string;
    sha256: string;
    uploadedBy: number;
    uploadedAt: string;
  } | null;
};

export type NightReport = {
  id: number;
  counterId: number;
  activityDate: string;
  status: NightReportStatus;
  notes: string | null;
  productId: number | null;
  productName: string | null;
  requiresCostReconciliation: boolean;
  costReconciliation: {
    required: boolean;
    resolved: boolean;
    resolution: 'not_required' | 'linked_costs' | 'no_extra_cost_confirmed' | 'unresolved';
    linkedCostCount: number;
    noExtraCostConfirmed: boolean;
    noExtraCostConfirmedAt: string | null;
    noExtraCostConfirmedBy: {
      id: number;
      fullName: string;
    } | null;
  };
  leader: NightReportLeader | null;
  counter: NightReportCounterRef | null;
  venues: NightReportVenue[];
  photos: NightReportPhoto[];
  costs: NightReportCost[];
  financeSummary: NightReportFinanceSummary;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type NightReportVenueInput = {
  orderIndex?: number;
  venueName: string;
  venueId?: number;
  totalPeople: number;
  isOpenBar?: boolean;
  normalCount?: number | null;
  cocktailsCount?: number | null;
  brunchCount?: number | null;
};

export type NightReportCreatePayload = {
  counterId: number;
  leaderId?: number;
  activityDate?: string;
  notes?: string | null;
  venues?: NightReportVenueInput[];
};

export type NightReportUpdatePayload = {
  activityDate?: string;
  notes?: string | null;
  leaderId?: number;
  venues?: NightReportVenueInput[];
};

export type NightReportPhotoUploadResponse = {
  id: number;
  originalName: string;
  mimeType: string;
  fileSize: number;
  capturedAt: string | null;
  downloadUrl: string;
};

export type NightReportCostCreatePayload = {
  date: string;
  accountId: number;
  currency: string;
  amountMinor: number;
  categoryId: number | null;
  counterpartyId: number;
  paymentMethod?: string | null;
  status?: 'planned' | 'approved' | 'awaiting_reimbursement' | 'paid' | 'reimbursed' | 'void';
  description?: string | null;
  invoiceFileId?: number | null;
};

export type NightReportReceiptAllocationCreatePayload = {
  date: string;
  accountId: number;
  currency: string;
  receiptTotalMinor: number;
  categoryId: number | null;
  counterpartyId: number;
  paymentMethod?: string | null;
  status?: 'planned' | 'approved' | 'awaiting_reimbursement' | 'paid' | 'reimbursed' | 'void';
  description?: string | null;
  invoiceFileId?: number | null;
  lines: Array<{
    reportId: number;
    amountMinor: number;
    receiptAllocationNote?: string | null;
    receiptItems?: Array<{
      description?: string | null;
      quantity?: number;
      amountMinor: number;
    }>;
  }>;
};
