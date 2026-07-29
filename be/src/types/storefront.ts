export type StorefrontParticipantMode = 'quantity' | 'gender_split';
export type StorefrontTimeMode = 'fixed' | 'select' | 'manual';

export type StorefrontProductConfig = {
  participantMode?: StorefrontParticipantMode;
  minParticipants?: number;
  maxParticipants?: number;
  dateRequired?: boolean;
  timeMode?: StorefrontTimeMode;
  defaultStartTime?: string;
  startTimes?: string[];
  fullNameRequired?: boolean;
  emailRequired?: boolean;
  phoneRequired?: boolean;
};

export type StorefrontAddonSelectionMode = 'boolean' | 'quantity' | 'range' | 'options';

export type StorefrontAddonOption = {
  value: string;
  label: string;
  price?: number;
};

export type StorefrontAddonConfig = {
  selectionMode?: StorefrontAddonSelectionMode;
  allowedQuantities?: number[];
  minQuantity?: number;
  maxQuantity?: number;
  /**
   * Maps a permitted quantity to the total bundle price. For example,
   * `{ "3": 50 }` means three units cost 50 in total, not 50 each.
   */
  quantityPrices?: Record<string, number>;
  options?: StorefrontAddonOption[];
};
