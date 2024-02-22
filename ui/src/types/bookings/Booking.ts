export type Booking = {
    id: number;
    checkInDate: Date;
    checkOutDate: Date;
    totalAmount: number;
    paymentStatus: string;
    roomType: string;
    numGuests: number;
    notes: string;
    guestId: number, 
    channelId: number;
    createdAt: Date;
    updatedAt: Date;
    createdBy: number;
    updatedBy: number;
};