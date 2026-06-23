export type UserType = {
    id: number;
    slug?: string;
    name: string;
    description?: string | null;
    isDefault?: boolean;
    status?: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdBy: number;
    updatedBy: number;
};
