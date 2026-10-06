export type StorefrontParticipantMode = 'quantity' | 'gender_split';
export type StorefrontDateMode = 'flexible' | 'fixed' | 'allowed_dates';
export type StorefrontTimeMode = 'fixed' | 'select' | 'manual';
export type StorefrontBookingSection = 'date_time' | 'group_size' | 'contact_details' | 'addons';

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

export type StorefrontAvailabilityBlockedDate = {
  date: string;
  reason?: string;
  redirectProductId?: number | null;
  redirectProductSlug?: string | null;
  redirectUrl?: string | null;
};

export type StorefrontAvailabilityDateOverride = {
  date: string;
  enabled?: boolean;
  mode?: 'available' | 'blocked';
  cutoffMinutes?: number;
  reason?: string;
  redirectProductId?: number | null;
  redirectProductSlug?: string | null;
  redirectUrl?: string | null;
};

export type StorefrontAvailabilityConfig = {
  dateMode?: StorefrontDateMode;
  fixedDate?: string;
  allowedDates?: string[];
  cutoffMinutes?: number;
  blockedDates?: StorefrontAvailabilityBlockedDate[];
  dateOverrides?: StorefrontAvailabilityDateOverride[];
};

export type StorefrontProductConfig = {
  participantMode?: StorefrontParticipantMode;
  minParticipants?: number;
  maxParticipants?: number;
  sectionOrder?: StorefrontBookingSection[];
  dateRequired?: boolean;
  timeMode?: StorefrontTimeMode;
  defaultStartTime?: string;
  startTimes?: string[];
  fullNameRequired?: boolean;
  emailRequired?: boolean;
  phoneRequired?: boolean;
  content?: StorefrontProductContent;
  availability?: StorefrontAvailabilityConfig;
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
