import { parsePartnerCsv } from '../partnerCsvImport';

const header = 'reference,firstName,lastName,email,productId,quantity,experienceDate,experienceTime,paymentMode';
it('preserves separate NYE times inside one customer order', () => {
  const result = parsePartnerCsv(`${header}\nbooking-1,Alex,Morgan,alex@example.invalid,28,2,2027-12-31,17:00,platform\nbooking-1,Alex,Morgan,alex@example.invalid,28,2,2027-12-31,19:30,platform`, 100);
  expect(result).toHaveLength(1);
  expect(result[0].items.map(item => item.experienceTime)).toEqual(['17:00', '19:30']);
});
it('does not merge different customers who reuse a booking reference', () => {
  expect(() => parsePartnerCsv(`${header}\nbooking-1,Alex,Morgan,alex@example.invalid,28,2,2027-01-10,21:00,platform\nbooking-1,Other,Person,other@example.invalid,28,2,2027-01-10,21:00,platform`, 100)).toThrow(/same customer/);
});
it('enforces the configured booking limit before creating anything', () => {
  expect(() => parsePartnerCsv(`${header}\nbooking-1,Alex,Morgan,alex@example.invalid,28,2,2027-01-10,21:00,platform\nbooking-2,Alex,Morgan,alex@example.invalid,28,2,2027-01-10,21:00,platform`, 1)).toThrow(/at most 1/);
});
it('handles a UTF-8 BOM and quoted customer names', () => {
  const rows = parsePartnerCsv(`\ufeff${header}\nbooking-1,"Alex, Jr",Morgan,alex@example.invalid,28,2,2027-01-10,21:00,platform`, 100);
  expect(rows[0].customer.firstName).toBe('Alex, Jr');
});
