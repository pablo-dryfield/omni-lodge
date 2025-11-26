export type VenuePayoutCurrencyTotals = {
  currency: string;
  receivable: number;
  payable: number;
  net: number;
};

export type VenuePayoutVenueBreakdown = {
  venueId: number | null;
  venueName: string;
  currency: string;
  receivable: number;
  payable: number;
  net: number;
};

export type VenuePayoutSummary = {
  period: string;
  range: {
    startDate: string;
    endDate: string;
  };
  totalsByCurrency: VenuePayoutCurrencyTotals[];
  venues: VenuePayoutVenueBreakdown[];
};
