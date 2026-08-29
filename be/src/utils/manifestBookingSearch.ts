import { col, fn, Op, type WhereOptions, where as sequelizeWhere } from 'sequelize';

const escapeSearchTerm = (input: string): string =>
  input.replace(/[%_]/g, (match) => `\\${match}`);

const parseInternalBookingId = (term: string): number | null => {
  const match = term.match(/^#?(\d+)$/);
  if (!match) {
    return null;
  }

  const bookingId = Number(match[1]);
  return Number.isSafeInteger(bookingId) && bookingId > 0 ? bookingId : null;
};

export const buildManifestBookingSearchWhere = (term: string): WhereOptions => {
  const safeTerm = escapeSearchTerm(term);
  const likeValue = `%${safeTerm}%`;
  const internalBookingId = parseInternalBookingId(term);

  return {
    [Op.or]: [
      ...(internalBookingId === null ? [] : [{ id: internalBookingId }]),
      { platformBookingId: { [Op.iLike]: likeValue } },
      { guestPhone: { [Op.iLike]: likeValue } },
      { guestEmail: { [Op.iLike]: likeValue } },
      { guestFirstName: { [Op.iLike]: likeValue } },
      { guestLastName: { [Op.iLike]: likeValue } },
      sequelizeWhere(fn('concat_ws', ' ', col('guest_first_name'), col('guest_last_name')), {
        [Op.iLike]: likeValue,
      }),
    ],
  };
};
