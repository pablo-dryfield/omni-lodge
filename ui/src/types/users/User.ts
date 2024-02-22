export type User = {
    id: number;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: number;
    updatedBy: number;
};