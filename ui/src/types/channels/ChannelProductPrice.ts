export type ChannelProductPrice = {
  id: number;
  channelId: number;
  productId: number;
  price: number;
  validFrom: string;
  validTo: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  channelName?: string | null;
  productName?: string | null;
  createdByName?: string | null;
  updatedByName?: string | null;
};
