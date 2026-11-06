export const REZDY_DEFAULT_START_TIMES_KEY = 'REZDY_DEFAULT_START_TIMES';

/** An empty map leaves date-only orders for manual review. */
export const parseRezdyDefaultStartTimes = (value: unknown): Record<string, string> => {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Rezdy default start times must be a JSON object mapping product codes to HH:mm times.');
  }
  const result: Record<string, string> = {};
  for (const [productCode, time] of Object.entries(parsed)) {
    if (!/^P[A-Z0-9_-]{3,}$/.test(productCode)) {
      throw new Error(`Invalid Rezdy product code: ${productCode}. Use the uppercase P code from the order email.`);
    }
    if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new Error(`Default start time for ${productCode} must use HH:mm, for example 14:00.`);
    }
    result[productCode] = time;
  }
  return result;
};
