export type Counter = {
    id: number;
    userId: number;
    total: number;
    date: Date | string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: number;
    updatedBy: number;
    notes?: string | null;
    manager?: {
        firstName: string | null;
        lastName: string | null;
    } | null;
    product?: {
        id: number;
        name: string;
    } | null;
};
