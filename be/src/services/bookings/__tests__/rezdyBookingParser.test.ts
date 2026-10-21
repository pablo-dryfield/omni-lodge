jest.mock('../../configService.js', () => ({ getConfigValue: jest.fn(() => null) }));

import { RezdyBookingParser } from '../parsers/rezdyBookingParser.js';
import type { BookingParserContext } from '../types.js';

const parser = new RezdyBookingParser();
const context = (overrides: Partial<BookingParserContext> = {}): BookingParserContext => ({
  messageId: 'rezdy-fixture', receivedAt: new Date('2026-10-20T12:00:00Z'),
  from: 'Rezdy <noreply@rezdy.com>', headers: {},
  subject: 'New Confirmed order RTEST01 for Taylor Example from Viator',
  // Real plain alternatives omit product, commission and agent booking reference.
  textBody: 'Order Total PLN300.00 You have received a new order, number RTEST01 Status: Confirmed',
  htmlBody: `<h1>New Agent Order</h1><h2>CONFIRMED</h2><h3>Viator VIATOR</h3>
    <small>Agent Reference</small><strong>1234567890</strong>
    <small>Order Number</small><h3>RTEST01</h3><small>Items Ordered</small><strong>1</strong>
    <small>Order Total</small><h3>PLN300.00</h3><small>Commission</small><h3>PLN60.00</h3>
    <small>Total Paid</small><h3>PLN300.00</h3><small>Total Discount</small><h3>PLN0.00</h3>
    <small>Name</small><span>Taylor Example</span><small>Email</small><span>guest@example.test</span>
    <small>Phone</small><span>+48111222333</span><h3>Payment History</h3>
    <h2>Krakow Food Tour (PTEST01)</h2><h3>Saturday, October 31, 2026 2:00 PM</h3>
    <h3>Item Summary</h3><table><tr><td>3</td><td>Participants</td><td>PLN100.00</td><td>PLN300.00</td></tr></table>`,
  ...overrides,
});

describe('Rezdy operational email parsing', () => {
  it('uses HTML-only product, commission and explicit Viator reference without guessing', async () => {
    const event = await parser.parse(context());
    expect(event).toEqual(expect.objectContaining({
      platform: 'rezdy', platformBookingId: 'RTEST01', platformOrderId: 'RTEST01', status: 'confirmed', eventType: 'created',
      bookingFields: expect.objectContaining({
        productName: 'Krakow Food Tour', productVariant: 'PTEST01', experienceDate: '2026-10-31',
        experienceStartAt: new Date('2026-10-31T13:00:00Z'), partySizeTotal: 3,
        guestFirstName: 'Taylor', guestLastName: 'Example', guestEmail: 'guest@example.test', currency: 'PLN',
      }),
      rawPayload: { rezdy: expect.objectContaining({ orderId: 'RTEST01', agent: 'viator',
        viatorReference: 'BR-1234567890', grossTotal: 300, commission: 60, totalPaid: 300 }) },
    }));
    expect(event?.rawPayload?.rezdy).not.toHaveProperty('validationError');
  });

  it.each(['RTEST01 has been cancelled', 'RTEST01 has been canceled'])('recognizes Order %s without inventing a refund', async (subject) => {
    const event = await parser.parse(context({ subject: `Order ${subject}` }));
    expect(event).toEqual(expect.objectContaining({ status: 'cancelled', eventType: 'cancelled' }));
    expect(event?.paymentStatus).toBeUndefined();
    expect(event?.rawPayload?.rezdy).not.toHaveProperty('refundTotal');
  });

  it.each(['Order RTEST01 has been amended', 'Updated order RTEST01', 'Order RTEST01 modified'])('recognizes %s', async (subject) => {
    const event = await parser.parse(context({ subject }));
    expect(event).toEqual(expect.objectContaining({ status: 'amended', eventType: 'amended' }));
  });

  it('prefers explicitly new dates/counts over a quoted old snapshot', async () => {
    const c = context({ subject: 'Order RTEST01 updated' });
    c.htmlBody += '<p>New Experience Date: November 2, 2026 9:00 PM New Participants: 2</p>';
    const event = await parser.parse(c);
    expect(event?.bookingFields).toEqual(expect.objectContaining({ experienceDate: '2026-11-02',
      experienceStartAt: new Date('2026-11-02T20:00:00Z'), partySizeTotal: 2 }));
  });

  it('accepts a cumulative partial refund and does not interpret it as a cancellation', async () => {
    const c = context({ subject: 'Partial refund processed for order RTEST01' });
    c.htmlBody = c.htmlBody!.replace('<h3>Payment History</h3>', '<small>Total Refunded</small><b>PLN50.00</b><h3>Payment History</h3>');
    const event = await parser.parse(c);
    expect(event?.status).toBe('amended');
    expect(event?.rawPayload?.rezdy).toEqual(expect.objectContaining({ refundTotal: 50, refundCurrency: 'PLN' }));
  });

  it('requires a stable refund identity for individual refund amounts', async () => {
    const c = context({ subject: 'Refund confirmation for order RTEST01' });
    c.htmlBody = c.htmlBody!.replace('<h3>Payment History</h3>', '<small>Refund Amount</small><b>PLN25.00</b><h3>Payment History</h3>');
    expect((await parser.parse(c))?.rawPayload?.rezdy).toHaveProperty('validationError');
    c.htmlBody = c.htmlBody!.replace('<h3>Payment History</h3>', '<p>Refund Reference: refund_123</p><h3>Payment History</h3>');
    expect((await parser.parse(c))?.rawPayload?.rezdy).toEqual(expect.objectContaining({ refundAmount: 25, refundReference: 'refund_123' }));
    expect((await parser.parse(c))?.rawPayload?.rezdy).not.toHaveProperty('validationError');
  });

  it.each(['Refund requested for order RTEST01', 'Pending refund for order RTEST01', 'Refund failed for order RTEST01',
    'Rezdy maintenance is underway', 'Re: Order RTEST01 has been cancelled'])('ignores %s', async (subject) => {
    expect(await parser.parse(context({ subject }))).toBeNull();
  });

  it.each(['Support <support@rezdy.com>', 'Rezdy <noreply@rezdy.com.evil.test>', 'noreply@fake-rezdy.com'])('rejects non-notification sender %s', async (from) => {
    expect(await parser.parse(context({ from }))).toBeNull();
  });

  it('reads localized amounts, Unicode names, children and additive add-on quantities', async () => {
    const c = context();
    c.htmlBody = c.htmlBody!.replace(/PLN300.00/g, 'EUR1.234,56').replace('PLN60.00', 'EUR234,56').replace('PLN0.00', 'EUR0,00')
      .replace('Taylor Example', 'Áda Testová').replace('<td>3</td><td>Participants</td>', '<td>2</td><td>Adults</td>')
      .replace('</table>', '<tr><td>1</td><td>Child</td></tr><tr><td>2</td><td>Unlimited Cocktails</td></tr><tr><td>3</td><td>Instant Photos</td></tr></table>');
    const event = await parser.parse(c);
    expect(event?.bookingFields).toEqual(expect.objectContaining({ currency: 'EUR', guestFirstName: 'Áda',
      partySizeTotal: 3, partySizeAdults: 2, partySizeChildren: 1, addonsSnapshot: { extras: { cocktails: 2, photos: 3, tshirts: 0 } } }));
    expect(event?.rawPayload?.rezdy).toEqual(expect.objectContaining({ grossTotal: 1234.56, commission: 234.56 }));
  });

  it('does not mistake a non-Viator agent reference for a Viator booking', async () => {
    const c = context({ subject: 'New Confirmed order RTEST01 for Taylor Example' });
    c.htmlBody = c.htmlBody!.replace('Viator VIATOR', 'Other Agent');
    expect((await parser.parse(c))?.rawPayload?.rezdy).toEqual(expect.objectContaining({ agent: null, viatorReference: null }));
  });

  it('recognizes cancellation agent notes and supplier net even without a reseller heading or commission field', async () => {
    const c = context({ subject: 'Order RTEST01 has been cancelled' });
    c.htmlBody = c.htmlBody!.replace('<h3>Viator VIATOR</h3>', '<p>Agent Notes Viator #1234567890 - Net amount: PLN240.00</p>')
      .replace('<small>Commission</small><h3>PLN60.00</h3>', '');
    expect((await parser.parse(c))?.rawPayload?.rezdy).toEqual(expect.objectContaining({ agent: 'viator', viatorReference: 'BR-1234567890', netTotal: 240 }));
  });

  it('handles whitespace thousands separators without truncating the order amount', async () => {
    const c = context();
    c.htmlBody = c.htmlBody!.replace(/PLN300.00/g, 'PLN1\u00a0234,56');
    expect((await parser.parse(c))?.rawPayload?.rezdy).toHaveProperty('grossTotal', 1234.56);
  });

  it('does not silently shift a nonexistent local departure time at daylight-saving changeover', async () => {
    const c = context({ subject: 'Order RTEST01 updated' });
    c.htmlBody = c.htmlBody!.replace('Saturday, October 31, 2026 2:00 PM', 'Sunday, March 29, 2026 2:30 AM');
    const event = await parser.parse(c);
    expect(event?.rawPayload?.rezdy).toHaveProperty('validationError', expect.stringContaining('manual review'));
    expect(event?.bookingFields?.experienceStartAt).toBeUndefined();
  });

  it('stops multi-item orders and mismatched order IDs for manual review', async () => {
    const c = context();
    c.htmlBody = c.htmlBody!.replace('<strong>1</strong>', '<strong>10</strong>');
    expect((await parser.parse(c))?.rawPayload?.rezdy).toHaveProperty('validationError', expect.stringContaining('Multi-item'));
    const mismatch = context({ htmlBody: '<p>Order number ROTHER1</p>' });
    expect((await parser.parse(mismatch))?.rawPayload?.rezdy).toHaveProperty('validationError');
  });

  it('does not create a guessed departure for an undated voucher', async () => {
    const c = context();
    c.htmlBody = c.htmlBody!.replace('Saturday, October 31, 2026 2:00 PM', 'Gift Card ABC123');
    expect((await parser.parse(c))?.rawPayload?.rezdy).toHaveProperty('validationError');
  });

  it('does not read refund instructions in customer notes as completed refunds', async () => {
    const c = context();
    c.htmlBody = c.htmlBody!.replace('<h3>Payment History</h3>', '<h3>Special Requirements</h3><p>Total Refunded PLN300.00 Refund Reference fake_request</p><h3>Payment History</h3>');
    expect((await parser.parse(c))?.rawPayload?.rezdy).not.toHaveProperty('refundTotal');
  });

  it('does not turn dates or participant counts in customer notes into operational amendments', async () => {
    const c = context();
    c.htmlBody = c.htmlBody!.replace('<h3>Payment History</h3>', '<h3>Special Requirements</h3><p>New Experience Date: November 2, 2026 9:00 PM New Participants: 99</p><h3>Payment History</h3>');
    expect((await parser.parse(c))?.bookingFields).toEqual(expect.objectContaining({ experienceDate: '2026-10-31', partySizeTotal: 3 }));
  });

  it('retains explicit zero add-ons when an amended complete snapshot removes them', async () => {
    const event = await parser.parse(context({ subject: 'Order RTEST01 updated' }));
    expect(event?.bookingFields?.addonsSnapshot).toEqual({ extras: { cocktails: 0, photos: 0, tshirts: 0 } });
  });

  it('parses complete plain-text templates, but fails safely when essential HTML-only fields are absent', async () => {
    const c = context({ htmlBody: null, subject: 'Last minute - New Confirmed order RTEST01 for Taylor Example', textBody:
      'Order Total PLN300.00 Total Paid PLN300.00 Product: Krakow Food Tour Product Code: PTEST01 Starts October 31, 2026 2:00 PM Participants: 3' });
    expect((await parser.parse(c))?.rawPayload?.rezdy).not.toHaveProperty('validationError');
    expect((await parser.parse(context({ htmlBody: null })))?.rawPayload?.rezdy).toHaveProperty('validationError');
  });
});
