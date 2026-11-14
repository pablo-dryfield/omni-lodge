/** Diagnostics for batch failures must identify the database problem without
 * copying email bodies, SQL values, credentials or arbitrary provider messages. */
export function describeBookingIngestionFailure(error: unknown): string {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const name = typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,100}$/.test(value.name) ? value.name : 'Error';
  const database = value.original && typeof value.original === 'object' ? value.original as Record<string, unknown> : {};
  const parts = [name];
  if (typeof database.code === 'string' && /^[A-Z0-9]{5}$/.test(database.code)) parts.push(`SQLSTATE ${database.code}`);
  if (typeof database.constraint === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,159}$/.test(database.constraint)) parts.push(`constraint ${database.constraint}`);
  const fields = value.fields && typeof value.fields === 'object' && !Array.isArray(value.fields) ? Object.keys(value.fields) : [];
  if (Array.isArray(value.errors)) for (const item of value.errors) {
    if (item && typeof item === 'object' && typeof item.path === 'string') fields.push(item.path);
  }
  const safeFields = [...new Set(fields.filter(field => /^[A-Za-z_][A-Za-z0-9_.]{0,99}$/.test(field)))].slice(0, 10);
  if (safeFields.length) parts.push(`fields ${safeFields.join(', ')}`);
  return parts.join('; ');
}
