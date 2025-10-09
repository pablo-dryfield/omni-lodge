export type Channel = {
    id: number;
    name: string;
    description: string;
    apiKey: string;
    apiSecret: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: number;
    updatedBy: number;
    paymentMethodId: number;
    paymentMethodName?: string | null;
    paymentMethod?: {
        id: number;
        name: string;
    } | null;
};
