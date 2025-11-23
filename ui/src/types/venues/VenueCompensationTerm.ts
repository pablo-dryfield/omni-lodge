export type VenueCompensationType = "open_bar" | "commission";
export type VenueCompensationDirection = "payable" | "receivable";
export type VenueCompensationRateUnit = "per_person" | "flat";

export type VenueCompensationTerm = {
  id: number;
  venueId: number;
  venueName?: string | null;
  compensationType: VenueCompensationType;
  direction: VenueCompensationDirection;
  rateAmount: number | string;
  rateUnit: VenueCompensationRateUnit;
  currencyCode: string;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdByName?: string | null;
  updatedByName?: string | null;
};

