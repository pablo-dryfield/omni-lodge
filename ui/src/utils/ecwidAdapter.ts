import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import { UnifiedOrder, UnifiedProduct } from "../store/bookingPlatformsTypes";

dayjs.extend(utc);

type EcwidOption = {
  name?: string;
  value?: string | number | null;
  selections?: Array<{ name?: string; value?: string | number }>;
};

type EcwidExtraField = {
  id?: string;
  name?: string;
  value?: string | number | null;
};

type EcwidPerson = {
  name?: string;
  phone?: string;
};

type EcwidOrderItem = {
  id?: string | number;
  productId?: string | number;
  sku?: string;
  name?: string;
  quantity?: number;
  options?: EcwidOption[];
  pickupTime?: string;
};

type EcwidOrder = {
  id: string | number;
  items: EcwidOrderItem[];
  createDate?: string;
  pickupTime?: string;
  orderExtraFields?: EcwidExtraField[];
  extraFields?: Record<string, string>;
  shippingPerson?: EcwidPerson;
  billingPerson?: EcwidPerson;
};

const normalizeEcwidTimestamp = (value?: string): Dayjs | null => {
  if (!value) {
    return null;
  }

  const sanitized = value
    .replace(" ", "T")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

  const parsed = dayjs(sanitized);
  return parsed.isValid() ? parsed : null;
};

const preferPickupMoment = (order: EcwidOrder, item: EcwidOrderItem): Dayjs | null => {
  const candidates: Array<string | undefined> = [];

  item.options?.forEach((option) => {
    if (!option?.value) {
      return;
    }

    if (
      (option.name && /pickup|time|slot|start|date/i.test(option.name)) ||
      /pickup|time|slot|start|date/i.test(String(option.value))
    ) {
      candidates.push(String(option.value));
    }

    option.selections?.forEach((selection) => {
      if (selection?.value && /pickup|time|slot|start|date/i.test(String(selection.value))) {
        candidates.push(String(selection.value));
      }
    });
  });

  candidates.push(item.pickupTime);
  candidates.push(order.pickupTime);
  candidates.push(order.extraFields?.ecwid_order_pickup_time);

  const extraFieldCandidate = order.orderExtraFields?.find((field) =>
    field?.name ? /pickup|time|slot|start/i.test(field.name) : false,
  );

  if (extraFieldCandidate?.value) {
    candidates.push(String(extraFieldCandidate.value));
  }

  for (const candidate of candidates) {
    const parsed = normalizeEcwidTimestamp(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const countMatches = (text: string, pattern: RegExp): number => {
  const matches = text.matchAll(pattern);
  let total = 0;

  for (const match of matches) {
    const value = match[1];
    if (value) {
      const qty = Number.parseInt(value, 10);
      if (!Number.isNaN(qty)) {
        total += qty;
      }
    }
  }

  return total;
};

const extractCountsFromText = (raw?: string | number | null) => {
  if (raw === null || raw === undefined) {
    return { men: 0, women: 0 };
  }

  if (typeof raw === "number") {
    return { men: raw, women: 0 };
  }

  const text = String(raw).toLowerCase();

  return {
    men: countMatches(text, /(\d+)\s*(?:men|man|male)/g),
    women: countMatches(text, /(\d+)\s*(?:women|woman|female)/g),
  };
};

const accumulateGenderCounts = (
  target: { men: number; women: number },
  payload?: string | number | null,
  explicitGender?: "men" | "women",
): void => {
  if (payload === null || payload === undefined) {
    return;
  }

  if (typeof payload === "number") {
    if (explicitGender === "women") {
      target.women += payload;
    } else {
      target.men += payload;
    }
    return;
  }

  const numericValue = Number.parseInt(String(payload), 10);
  if (!Number.isNaN(numericValue) && explicitGender) {
    target[explicitGender] += numericValue;
    return;
  }

  const extracted = extractCountsFromText(payload);
  target.men += extracted.men;
  target.women += extracted.women;
};

const extractGenderCounts = (order: EcwidOrder, item: EcwidOrderItem): { men: number; women: number } => {
  const totals = { men: 0, women: 0 };

  item.options?.forEach((option) => {
    if (!option) {
      return;
    }

    const optionName = option.name?.toLowerCase();

    if (optionName?.includes("men")) {
      accumulateGenderCounts(totals, option.value, "men");
    } else if (optionName?.includes("women")) {
      accumulateGenderCounts(totals, option.value, "women");
    } else {
      accumulateGenderCounts(totals, option.value);
    }

    option.selections?.forEach((selection) => {
      const selectionName = selection.name?.toLowerCase();
      if (selectionName?.includes("men")) {
        accumulateGenderCounts(totals, selection.value, "men");
      } else if (selectionName?.includes("women")) {
        accumulateGenderCounts(totals, selection.value, "women");
      } else {
        accumulateGenderCounts(totals, selection.value);
      }
    });
  });

  order.orderExtraFields?.forEach((field) => {
    const fieldName = field.name?.toLowerCase();
    if (fieldName?.includes("men")) {
      accumulateGenderCounts(totals, field.value, "men");
    } else if (fieldName?.includes("women")) {
      accumulateGenderCounts(totals, field.value, "women");
    } else {
      accumulateGenderCounts(totals, field.value);
    }
  });

  if (order.extraFields) {
    Object.entries(order.extraFields).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes("men")) {
        accumulateGenderCounts(totals, value, "men");
      } else if (lowerKey.includes("women")) {
        accumulateGenderCounts(totals, value, "women");
      }
    });
  }

  return totals;
};

const toUnifiedProduct = (productId: string, productName: string): UnifiedProduct => ({
  id: productId,
  name: productName,
  platform: "ecwid",
});

export const transformEcwidOrders = (ecwidOrders: EcwidOrder[]) => {
  const productsMap = new Map<string, UnifiedProduct>();
  const orders: UnifiedOrder[] = [];

  ecwidOrders.forEach((order) => {
    order.items?.forEach((item, index) => {
      const productId = String(item.productId ?? item.id ?? item.sku ?? `unknown-${index}`);
      const productName = item.name ?? "Unknown product";

      if (!productsMap.has(productId)) {
        productsMap.set(productId, toUnifiedProduct(productId, productName));
      }

      const pickupMoment = preferPickupMoment(order, item);
      const fallbackMoment = normalizeEcwidTimestamp(order.createDate);
      const effectiveMoment = (pickupMoment ?? fallbackMoment ?? dayjs()).utc();

      const { men, women } = extractGenderCounts(order, item);
      const quantity = Number(item.quantity ?? 0);

      orders.push({
        id: `${order.id}-${item.id ?? item.productId ?? index}`,
        platformBookingId: String(order.id),
        productId,
        productName,
        date: effectiveMoment.format("YYYY-MM-DD"),
        timeslot: effectiveMoment.format("HH:mm"),
        quantity,
        menCount: men,
        womenCount: women,
        customerName: order.shippingPerson?.name ?? order.billingPerson?.name ?? "",
        customerPhone: order.shippingPerson?.phone ?? order.billingPerson?.phone,
        platform: "ecwid",
        pickupDateTime: pickupMoment?.toISOString(),
        rawData: { order, item },
      });
    });
  });

  const products = Array.from(productsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return {
    products,
    orders,
    raw: ecwidOrders,
  };
};
