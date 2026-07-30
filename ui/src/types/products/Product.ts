export type StorefrontParticipantMode = "quantity" | "gender_split";
export type StorefrontTimeMode = "fixed" | "select" | "manual";

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
