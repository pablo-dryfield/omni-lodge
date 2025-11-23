export type VenueCompensationTermRate = {
  id: number;
  termId: number;
  productId: number | null;
  ticketType: 'normal' | 'cocktail' | 'brunch' | 'generic';
  rateAmount: number;
  rateUnit: 'per_person' | 'flat';
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
  venueName?: string | null;
  termLabel?: string | null;
  productName?: string | null;
};

