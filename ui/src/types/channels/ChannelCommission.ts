export type ChannelCommission = {
  id: number;
  channelId: number;
  rate: number;
  validFrom: string;
  validTo: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  channelName?: string | null;
  createdByName?: string | null;
  updatedByName?: string | null;
};
