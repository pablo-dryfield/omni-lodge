export type Counter = {
    id: number;
    userId: number;
    total: number;
    date: Date | string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: number;
    updatedBy: number;
    manager?: {
        firstName: string | null;
        lastName: string | null;
    } | null;
    product?: {
        id: number;
        name: string;
    } | null;
};
