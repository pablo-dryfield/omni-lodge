export type NightReportStatus = 'draft' | 'submitted';

export type NightReportSummary = {
  id: number;
  activityDate: string;
  leaderName: string;
  status: NightReportStatus;
  venuesCount: number;
  totalPeople: number;
  counterId: number;
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

export type NightReport = {
  id: number;
  counterId: number;
  activityDate: string;
  status: NightReportStatus;
  notes: string | null;
  leader: NightReportLeader | null;
  counter: NightReportCounterRef | null;
  venues: NightReportVenue[];
  photos: NightReportPhoto[];
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
