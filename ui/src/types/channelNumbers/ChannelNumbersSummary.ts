export type ChannelNumbersAddon = {
  addonId: number;
  name: string;
  key: string;
  productId: number | null;
  productName: string | null;
  productTypeId: number | null;
  productTypeName: string | null;
};

export type ChannelNumbersRow = {
  channelId: number;
  channelName: string;
  normal: number;
  normalNonShow: number;
  addons: Record<string, number>;
  addonNonShow: Record<string, number>;
  total: number;
  products: Record<string, ChannelProductMetrics>;
};

export type ChannelNumbersProductType = {
  id: number;
  name: string;
};

export type ChannelNumbersProduct = {
  id: number;
  name: string;
  productTypeId: number | null;
  productTypeName: string | null;
  addonKeys: string[];
};

export type ChannelProductMetrics = {
  productId: number | null;
  normal: number;
  nonShow: number;
  addons: Record<string, number>;
  addonNonShow: Record<string, number>;
  total: number;
};

export type ChannelNumbersSummary = {
  startDate: string;
  endDate: string;
  channels: ChannelNumbersRow[];
  addons: ChannelNumbersAddon[];
  productTypes: ChannelNumbersProductType[];
  products: ChannelNumbersProduct[];
  productTotals: Record<string, ChannelProductMetrics>;
  totals: {
    normal: number;
    normalNonShow: number;
    addons: Record<string, number>;
    addonNonShow: Record<string, number>;
    total: number;
  };
};
