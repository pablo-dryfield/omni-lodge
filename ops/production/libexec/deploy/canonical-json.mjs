const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

export const requirePlainObject = (value, label) => {
  invariant(isPlainObject(value), `${label} must be a JSON object`);
  return value;
};

export const requireExactKeys = (value, expectedKeys, label) => {
  const object = requirePlainObject(value, label);
  const keys = Object.keys(object);
  invariant(
    keys.length === expectedKeys.length
      && keys.every((key, index) => key === expectedKeys[index]),
    `${label} schema is not canonical`,
  );
  return object;
};

export const serializeCanonicalJson = (value) => {
  const serialized = JSON.stringify(value, null, 2);
  invariant(typeof serialized === 'string', 'Canonical JSON value is not serializable');
  return Buffer.from(`${serialized}\n`, 'utf8');
};

export const parseCanonicalJson = (bytes, {
  label = 'Canonical JSON',
  maximumBytes = 64 * 1024,
  validate = (value) => value,
} = {}) => {
  invariant(Buffer.isBuffer(bytes), `${label} must be a Buffer`);
  invariant(bytes.buffer instanceof ArrayBuffer, `${label} must not use shared memory`);
  invariant(bytes.length > 0, `${label} must not be empty`);
  invariant(bytes.length <= maximumBytes, `${label} exceeds the byte limit`);

  let text;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  invariant(Buffer.from(text, 'utf8').equals(bytes), `${label} is not canonical UTF-8`);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  invariant(
    serializeCanonicalJson(parsed).equals(bytes),
    `${label} is not in exact canonical JSON form`,
  );
  return validate(parsed);
};

export const serializeCanonicalJsonLine = (value) => {
  const serialized = JSON.stringify(value);
  invariant(typeof serialized === 'string', 'Canonical JSON line is not serializable');
  invariant(!serialized.includes('\n') && !serialized.includes('\r'), 'Canonical JSON line contains a newline');
  return Buffer.from(`${serialized}\n`, 'utf8');
};
