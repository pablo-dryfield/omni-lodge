export type VenuePayoutCurrencyTotals = {
  currency: string;
  receivable: number;
  receivableCollected: number;
  receivableOutstanding: number;
  payable: number;
  payableCollected: number;
  payableOutstanding: number;
  net: number;
};

export type VenuePayoutVenueDaily = {
  date: string;
  reportId: number | null;
  totalPeople: number;
  amount: number;
  direction: "receivable" | "payable";
  normalCount: number;
  cocktailsCount: number;
  brunchCount: number;
};

export type VenuePayoutVenueBreakdown = {
  rowKey: string;
  venueId: number | null;
  venueName: string;
  currency: string;
  receivable: number;
  receivableCollected: number;
  receivableOutstanding: number;
  payable: number;
  payableCollected: number;
  payableOutstanding: number;
  net: number;
  totalPeople: number;
  totalPeopleReceivable: number;
  totalPeoplePayable: number;
  daily: VenuePayoutVenueDaily[];
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
