export type StorefrontParticipantMode = "quantity" | "gender_split";
export type StorefrontTimeMode = "fixed" | "select" | "manual";

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
    mode?: "available" | "blocked";
    cutoffMinutes?: number;
    reason?: string;
    redirectProductId?: number | null;
    redirectProductSlug?: string | null;
    redirectUrl?: string | null;
};

export type StorefrontAvailabilityConfig = {
    cutoffMinutes?: number;
    blockedDates?: StorefrontAvailabilityBlockedDate[];
    dateOverrides?: StorefrontAvailabilityDateOverride[];
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
    availability?: StorefrontAvailabilityConfig;
};

export type ProductImage = {
    url: string;
    alt: string;
    order: number;
};

export type Product = {
    id: number;
    name: string;
    productTypeId: number;
    price: number;
    createdAt: Date;
    updatedAt: Date;
    createdBy: number;
    updatedBy: number;
    status: boolean;
    requiresNightReportCostReconciliation: boolean;
    storefrontConfig: StorefrontProductConfig;
    imageUrl: string | null;
    images: ProductImage[];
};
