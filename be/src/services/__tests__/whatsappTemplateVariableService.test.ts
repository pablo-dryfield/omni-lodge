import { Op } from 'sequelize';

import Booking from '../../models/Booking.js';
import BookingAddon from '../../models/BookingAddon.js';
import type { WhatsAppTemplateDefinition } from '../../types/whatsappTemplates.js';
import {
  WhatsAppTemplateVariableError,
  buildWhatsAppTemplateSendComponents,
  listWhatsAppTemplateVariables,
  renderWhatsAppTemplatePreview,
  resolveWhatsAppTemplateVariables,
  searchWhatsAppTemplateBookings,
} from '../whatsappTemplateVariableService.js';

jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
}));

jest.mock('../../models/BookingAddon.js', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
  },
}));

jest.mock('../../models/Addon.js', () => ({
  __esModule: true,
  default: class Addon {},
}));

const bookingFindAll = Booking.findAll as jest.Mock;
const bookingFindByPk = Booking.findByPk as jest.Mock;
const bookingAddonFindAll = BookingAddon.findAll as jest.Mock;

const namedTemplate = (body: string): WhatsAppTemplateDefinition => ({
  name: 'booking_confirmation',
  language: 'en_US',
  category: 'UTILITY',
  parameterFormat: 'NAMED',
  messageSendTtlSeconds: null,
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Booking {{booking_reference}}' },
    { type: 'BODY', text: body },
    { type: 'FOOTER', text: 'OmniLodge' },
    {
      type: 'BUTTONS',
      buttons: [{
        type: 'URL',
        text: 'View booking',
        url: 'https://example.test/bookings/{{1}}',
      }],
    },
  ],
  bookingBindings: { buttons: { 0: ['booking_reference'] } },
});

const completeBooking = {
  id: 42,
  platformBookingId: 'GYG 42/ABC',
  guestFirstName: '  Alex\n',
  guestLastName: 'Taylor',
  guestEmail: 'alex@example.test',
  guestPhone: '+48 600 123 987',
  productName: 'Krakow Pub Crawl',
  productVariant: 'Standard',
  experienceDate: '2026-06-28',
  experienceStartAt: new Date('2026-06-28T18:30:00.000Z'),
  partySizeTotal: 3,
  partySizeAdults: 2,
  partySizeChildren: 1,
  pickupLocation: ' Main Square\nby the statue ',
  hotelName: 'Hotel Central',
  currency: 'pln',
  priceGross: '149.5',
  baseAmount: '120.00',
};

describe('whatsappTemplateVariableService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bookingFindByPk.mockResolvedValue(completeBooking);
    bookingAddonFindAll.mockResolvedValue([
      { quantity: 2, platformAddonName: 'T-shirt', addon: null },
      { quantity: 1, platformAddonName: null, addon: { name: 'Photo package' } },
    ]);
  });

  it('publishes only the allowlisted booking variables with synthetic examples', () => {
    const variables = listWhatsAppTemplateVariables();
    expect(variables.map(({ key }) => key)).toEqual([
      'booking_reference',
      'guest_first_name',
      'guest_full_name',
      'product_name',
      'product_variant',
      'experience_date',
      'experience_time',
      'experience_datetime',
      'party_size_total',
      'party_size_adults',
      'party_size_children',
      'pickup_location',
      'hotel_name',
      'currency',
      'total_amount',
      'addons_summary',
    ]);
    expect(variables.every(({ source }) => !source.includes('raw_payload'))).toBe(true);
    expect(variables.every(({ sampleValue }) => sampleValue.length > 0)).toBe(true);

    variables[0].label = 'mutated';
    expect(listWhatsAppTemplateVariables()[0].label).toBe('Booking reference');
  });

  it('returns no bookings for an empty search without querying the database', async () => {
    await expect(searchWhatsAppTemplateBookings('  ')).resolves.toEqual([]);
    expect(bookingFindAll).not.toHaveBeenCalled();
  });

  it('searches a maximum of 20 bookings and exposes only compact contact data', async () => {
    bookingFindAll.mockResolvedValue([completeBooking]);

    await expect(searchWhatsAppTemplateBookings('Alex_20%')).resolves.toEqual([{
      id: 42,
      reference: 'GYG 42/ABC',
      guestName: 'Alex Taylor',
      productName: 'Krakow Pub Crawl',
      experienceAt: '2026-06-28T18:30:00.000Z',
      phoneSuffix: '3987',
    }]);

    const options = bookingFindAll.mock.calls[0][0];
    expect(options.limit).toBe(20);
    expect(options.attributes).not.toContain('notes');
    expect(options.attributes).not.toContain('rawPayloadLocation');
    const clauses = options.where[Op.or];
    expect(clauses).toEqual(expect.arrayContaining([
      { guestEmail: { [Op.iLike]: '%Alex\\_20\\%%' } },
      { guestPhone: { [Op.iLike]: '%Alex\\_20\\%%' } },
    ]));
    expect(JSON.stringify(await searchWhatsAppTemplateBookings('Alex'))).not.toContain('example.test');
  });

  it('rejects an excessively long search instead of broadening it', async () => {
    await expect(searchWhatsAppTemplateBookings('a'.repeat(129))).rejects.toMatchObject({
      code: 'INVALID_SEARCH_QUERY',
    });
  });

  it('resolves booking and add-on fields with Europe/Warsaw formatting', async () => {
    const resolved = await resolveWhatsAppTemplateVariables(42);
    const values = Object.fromEntries(resolved.map(({ key, value }) => [key, value]));

    expect(values).toMatchObject({
      booking_reference: 'GYG 42/ABC',
      guest_first_name: 'Alex',
      guest_full_name: 'Alex Taylor',
      experience_date: '28 June 2026',
      experience_time: '20:30',
      experience_datetime: '28 June 2026 at 20:30',
      pickup_location: 'Main Square by the statue',
      currency: 'PLN',
      total_amount: '149.50 PLN',
      addons_summary: '2 x T-shirt, 1 x Photo package',
    });
    expect(bookingFindByPk).toHaveBeenCalledWith(42, expect.objectContaining({
      attributes: expect.not.arrayContaining(['notes', 'rawPayloadLocation', 'ipAddress']),
    }));
    expect(bookingAddonFindAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookingId: 42 },
    }));
  });

  it('renders named sample and booking previews, including an encoded URL value', async () => {
    const definition = namedTemplate(
      'Hi {{guest_first_name}}, {{product_name}} starts at {{experience_time}} for {{party_size_total}} guests.',
    );

    const sample = await renderWhatsAppTemplatePreview(definition);
    expect(sample.body).toBe(
      'Hi Alex, Krakow Pub Crawl starts at 20:00 for 3 guests.',
    );

    const booking = await renderWhatsAppTemplatePreview(definition, { bookingId: 42 });
    expect(booking.header?.text).toBe('Booking GYG 42/ABC');
    expect(booking.body).toBe(
      'Hi Alex, Krakow Pub Crawl starts at 20:30 for 3 guests.',
    );
    expect(booking.buttons[0].url).toBe('https://example.test/bookings/GYG%2042%2FABC');
    expect(booking.variables.map(({ key }) => key)).toEqual(expect.arrayContaining([
      'booking_reference',
      'guest_first_name',
      'product_name',
      'experience_time',
      'party_size_total',
    ]));
    expect(booking.missingVariables).toEqual([]);
  });

  it('shows missing booking data in preview but blocks creation of a send payload', async () => {
    bookingFindByPk.mockResolvedValue({
      ...completeBooking,
      hotelName: null,
    });
    const definition = namedTemplate('Your hotel is {{hotel_name}}.');

    await expect(renderWhatsAppTemplatePreview(definition, { bookingId: 42 })).resolves.toMatchObject({
      body: 'Your hotel is [missing: hotel_name].',
      missingVariables: ['hotel_name'],
    });

    await expect(buildWhatsAppTemplateSendComponents(definition, { bookingId: 42 }))
      .rejects.toMatchObject({
        code: 'MISSING_REQUIRED_VARIABLE',
        missingVariables: ['hotel_name'],
      });
  });

  it('builds named Meta send parameters for header, body, and dynamic URL buttons', async () => {
    const definition = namedTemplate('Hi {{guest_first_name}}, booking {{booking_reference}} is confirmed.');

    await expect(buildWhatsAppTemplateSendComponents(definition, { bookingId: 42 })).resolves.toEqual([
      {
        type: 'header',
        parameters: [{
          type: 'text',
          text: 'GYG 42/ABC',
          parameter_name: 'booking_reference',
        }],
      },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Alex', parameter_name: 'guest_first_name' },
          { type: 'text', text: 'GYG 42/ABC', parameter_name: 'booking_reference' },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{
          type: 'text',
          text: 'GYG%2042%2FABC',
        }],
      },
    ]);
  });

  it('supports explicit positional bindings independently for each component', async () => {
    const definition: WhatsAppTemplateDefinition = {
      ...namedTemplate('Hi {{1}}, booking {{2}} is confirmed.'),
      parameterFormat: 'POSITIONAL',
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Booking {{1}}' },
        { type: 'BODY', text: 'Hi {{1}}, booking {{2}} is confirmed.' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', text: 'View', url: 'https://example.test/b/{{1}}' }],
        },
      ],
    };

    await expect(buildWhatsAppTemplateSendComponents(definition, {
      bookingId: 42,
      positionalBindings: {
        header: ['booking_reference'],
        body: ['guest_first_name', 'booking_reference'],
        buttons: { 0: ['booking_reference'] },
      },
    })).resolves.toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'GYG 42/ABC' }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Alex' },
          { type: 'text', text: 'GYG 42/ABC' },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: 'GYG%2042%2FABC' }],
      },
    ]);
  });

  it('renders unmapped positional and named parameters safely in sample previews', async () => {
    const positional: WhatsAppTemplateDefinition = {
      ...namedTemplate('Hello {{1}}, booking {{2}} is ready.'),
      parameterFormat: 'POSITIONAL',
      components: [{ type: 'BODY', text: 'Hello {{1}}, booking {{2}} is ready.' }],
    };
    await expect(renderWhatsAppTemplatePreview(positional)).resolves.toMatchObject({
      body: 'Hello Sample 1, booking Sample 2 is ready.',
      missingVariables: [],
    });

    await expect(renderWhatsAppTemplatePreview(
      namedTemplate('Use code {{custom_code}}.'),
    )).resolves.toMatchObject({
      body: 'Use code Sample custom code.',
      missingVariables: [],
    });
  });

  it('renders Meta-managed authentication copy as an approximate sample', async () => {
    const definition: WhatsAppTemplateDefinition = {
      name: 'login_code',
      language: 'en_US',
      category: 'AUTHENTICATION',
      parameterFormat: 'POSITIONAL',
      messageSendTtlSeconds: 300,
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 10 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
      ],
    };

    await expect(renderWhatsAppTemplatePreview(definition)).resolves.toMatchObject({
      body: '123456 is your verification code. For your security, do not share this code.',
      footer: 'This code expires in 10 minutes.',
      buttons: [{ type: 'OTP', text: 'Copy code' }],
    });
  });

  it('does not allow unknown variable names or implicit positional mappings', async () => {
    await expect(renderWhatsAppTemplatePreview(namedTemplate('Hello {{bookings.guest_email}}')))
      .rejects.toBeInstanceOf(WhatsAppTemplateVariableError);

    const positional: WhatsAppTemplateDefinition = {
      ...namedTemplate('Hello {{1}}'),
      parameterFormat: 'POSITIONAL',
      components: [{ type: 'BODY', text: 'Hello {{1}}' }],
    };
    await expect(buildWhatsAppTemplateSendComponents(positional, { bookingId: 42 }))
      .rejects.toMatchObject({ code: 'INVALID_POSITIONAL_BINDINGS' });
  });

  it('rejects invalid booking IDs and missing bookings with safe error codes', async () => {
    await expect(resolveWhatsAppTemplateVariables(0)).rejects.toMatchObject({
      code: 'INVALID_BOOKING_ID',
    });
    bookingFindByPk.mockResolvedValue(null);
    await expect(resolveWhatsAppTemplateVariables(404)).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
  });
});
