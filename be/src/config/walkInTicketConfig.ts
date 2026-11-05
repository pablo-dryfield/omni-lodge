import { WALK_IN_TICKET_TYPE_LABELS } from '../constants/walkInTicketTypes.js';

export const WALK_IN_TICKET_CONFIG_KEY = 'COUNTER_WALK_IN_TICKET_TYPES';
export type WalkInTicketDefinition = { id: string; name: string; enabled: boolean };
export const DEFAULT_WALK_IN_TICKET_TYPES: WalkInTicketDefinition[] = Object.entries(WALK_IN_TICKET_TYPE_LABELS)
  .map(([id, name]) => ({ id, name, enabled: true }));

export function parseWalkInTicketTypes(value: unknown): WalkInTicketDefinition[] {
  const rows: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 50) {
    throw new Error('Provide between 1 and 50 ticket types. Custom and Free are always available separately.');
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  return rows.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Each ticket type must be an object.');
    const { id, name, enabled } = row as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(id) || ['custom', 'free', 'staff_free', 'staff_paid', '__proto__', 'constructor', 'prototype'].includes(id)) {
      throw new Error('Ticket IDs must start with a letter and contain only lowercase letters, numbers and underscores. Custom, Free, Staff Free and Staff Ticket are reserved.');
    }
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60 || /[\r\n]/.test(name)) throw new Error('Ticket names must contain 1–60 characters on one line.');
    const normalizedName = name.trim().toLowerCase();
    if (['custom', 'free', 'staff free', 'staff ticket'].includes(normalizedName.replace(/\s+/g, ' ')) || ids.has(id) || names.has(normalizedName)) throw new Error('Ticket IDs and names must be unique. Custom, Free, Staff Free and Staff Ticket are reserved.');
    if (typeof enabled !== 'boolean') throw new Error('Every ticket type needs an enabled switch.');
    ids.add(id); names.add(normalizedName);
    return { id, name: name.trim(), enabled };
  });
}
