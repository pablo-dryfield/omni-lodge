export const utf8ByteLength = (value: string): number => {
  try {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(value).byteLength;
    }
  } catch {
    // Fall through to the allocation-free UTF-8 counter below.
  }

  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800
      && codeUnit <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      // BMP values and unpaired surrogates both encode to three bytes (the
      // latter through the UTF-8 replacement character).
      bytes += 3;
    }
  }
  return bytes;
};

export const jsonUtf8ByteLength = (value: unknown): number => {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string"
      ? utf8ByteLength(serialized)
      : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

export type Utf8EventBatch<T> = {
  selected: T[];
  individuallyUnsendable: T[];
  body: string;
};

/**
 * Selects a JSON `{ events: [...] }` payload under an exclusive UTF-8 limit.
 * Individually invalid/oversized records are returned separately so callers
 * can replace them instead of retrying the same head-of-line record forever.
 */
export const selectUtf8EventBatch = <T>(
  items: T[],
  eventOf: (item: T) => unknown,
  maxItems: number,
  maxBytesExclusive: number,
): Utf8EventBatch<T> => {
  const prefix = '{"events":[';
  const suffix = ']}';
  const envelopeBytes = utf8ByteLength(prefix) + utf8ByteLength(suffix);
  const selected: T[] = [];
  const serializedEvents: string[] = [];
  const individuallyUnsendable: T[] = [];
  let bodyBytes = envelopeBytes;

  for (const item of items) {
    if (selected.length >= Math.max(0, maxItems)) break;
    let serialized: string | undefined;
    try {
      const candidate = JSON.stringify(eventOf(item));
      serialized = typeof candidate === "string" ? candidate : undefined;
    } catch {
      serialized = undefined;
    }
    if (serialized === undefined) {
      individuallyUnsendable.push(item);
      continue;
    }

    const serializedBytes = utf8ByteLength(serialized);
    if (envelopeBytes + serializedBytes >= maxBytesExclusive) {
      individuallyUnsendable.push(item);
      continue;
    }
    const separatorBytes = selected.length > 0 ? 1 : 0;
    if (bodyBytes + separatorBytes + serializedBytes >= maxBytesExclusive) {
      break;
    }
    selected.push(item);
    serializedEvents.push(serialized);
    bodyBytes += separatorBytes + serializedBytes;
  }

  return {
    selected,
    individuallyUnsendable,
    body: `${prefix}${serializedEvents.join(",")}${suffix}`,
  };
};
