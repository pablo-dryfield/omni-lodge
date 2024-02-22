export type Guest = {
    id: number;
    name: string;
    email: string;
    phoneNumber: string;
    address: string;
    paymentStatus: string;
    deposit: number;
    notes: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: number;
    updatedBy: number;
};