import { Op, type WhereOptions } from 'sequelize';

import { buildManifestBookingSearchWhere } from './manifestBookingSearch';

const getSearchClauses = (term: string): WhereOptions[] => {
  const where = buildManifestBookingSearchWhere(term);
  return (where[Op.or] ?? []) as WhereOptions[];
};

describe('buildManifestBookingSearchWhere', () => {
  it.each([
    ['82518', 82518],
    ['#82518', 82518],
  ])('matches the internal bookings table ID for %s', (term, expectedId) => {
    expect(getSearchClauses(term)).toEqual(expect.arrayContaining([{ id: expectedId }]));
  });

  it.each(['40761-20260819110313-600', 'Julia Fitzgerald', '0', '-12', '12.5'])(
    'does not add an internal ID condition for %s',
    (term) => {
      expect(
        getSearchClauses(term).some((clause) => Object.prototype.hasOwnProperty.call(clause, 'id')),
      ).toBe(false);
    },
  );

  it('keeps platform booking ID, contact, and customer-name matching', () => {
    const clauses = getSearchClauses('Julia');

    expect(clauses).toHaveLength(6);
    expect(clauses).toEqual(
      expect.arrayContaining([
        { platformBookingId: { [Op.iLike]: '%Julia%' } },
        { guestPhone: { [Op.iLike]: '%Julia%' } },
        { guestEmail: { [Op.iLike]: '%Julia%' } },
        { guestFirstName: { [Op.iLike]: '%Julia%' } },
        { guestLastName: { [Op.iLike]: '%Julia%' } },
      ]),
    );
  });
});
