import { DEFAULT_WALK_IN_TICKET_TYPES, parseWalkInTicketTypes } from '../walkInTicketConfig';
import { normalizeWalkInTicketType } from '../../constants/walkInTicketTypes';

describe('Walk-Ins ticket configuration', () => {
  it('supports new types, display order, disabled types and edited names', () => {
    const rows = [{ id: 'partner_special', name: 'Partner special', enabled: true }, { id: 'normal', name: 'Standard', enabled: false }];
    expect(parseWalkInTicketTypes(JSON.stringify(rows))).toEqual(rows);
    expect(normalizeWalkInTicketType('partner_special')).toBe('partner_special');
  });
  it('keeps all original types as the default', () => {
    expect(parseWalkInTicketTypes(DEFAULT_WALK_IN_TICKET_TYPES).map((type) => type.id)).toEqual(['normal', 'second_timers', 'third_timers', 'half_price', 'students', 'group']);
  });
  it.each(['custom', 'free', 'staff_free', '__proto__', 'constructor', 'Name With Spaces'])('rejects reserved or invalid ID %s', (id) => {
    expect(() => parseWalkInTicketTypes([{ id, name: 'Ticket', enabled: true }])).toThrow();
  });
  it.each(['Staff Free', ' staff   free '])('reserves the Staff Free name for named staff admissions: %s', name => {
    expect(() => parseWalkInTicketTypes([{ id: 'staff_special', name, enabled: true }])).toThrow('reserved');
  });
  it('rejects duplicate names, duplicate IDs, missing switches and oversized catalogs', () => {
    expect(() => parseWalkInTicketTypes([{ id: 'one', name: 'Normal', enabled: true }, { id: 'two', name: 'normal', enabled: true }])).toThrow();
    expect(() => parseWalkInTicketTypes([{ id: 'one', name: 'One', enabled: true }, { id: 'one', name: 'Two', enabled: true }])).toThrow();
    expect(() => parseWalkInTicketTypes([{ id: 'one', name: 'One' }])).toThrow();
    expect(() => parseWalkInTicketTypes(Array.from({ length: 51 }, (_, index) => ({ id: `ticket_${index}`, name: `Ticket ${index}`, enabled: true })))).toThrow();
  });
});
