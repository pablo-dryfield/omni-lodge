export type StorefrontParticipantMode = 'quantity' | 'gender_split';
export type StorefrontTimeMode = 'fixed' | 'select' | 'manual';

export type StorefrontMeetingPoint = {
  name?: string;
  address?: string;
  instructions?: string;
  mapUrl?: string;
};

export type StorefrontProductContent = {
  summary?: string;
  description?: string;
  highlights?: string[];
  importantInformation?: string[];
  meetingPoint?: StorefrontMeetingPoint;
};

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
  content?: StorefrontProductContent;
};

export type StorefrontCancellationPolicy = {
  title: string;
  summary: string;
  items: Array<{
    title: string;
    description: string;
  }>;
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
