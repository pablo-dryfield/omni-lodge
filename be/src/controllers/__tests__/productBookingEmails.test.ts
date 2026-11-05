jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/EmailTemplate.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), findByPk: jest.fn(), build: jest.fn() } }));
jest.mock('../../services/productScopeService.js', () => ({ getAllowedProductTypeIds: jest.fn() }));
jest.mock('../../services/bookingEmailScopeService.js', () => ({ ...jest.requireActual('../../services/bookingEmailScopeService.js'), getBookingEmailAccess: jest.fn() }));
jest.mock('../../services/bookings/gmailClient.js', () => ({ sendMessage: jest.fn(), fetchMessagePayload: jest.fn() }));
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import EmailTemplate from '../../models/EmailTemplate';
import Booking from '../../models/Booking';
import Product from '../../models/Product';
import { getAllowedProductTypeIds } from '../../services/productScopeService';
import { getBookingEmailAccess } from '../../services/bookingEmailScopeService';
import { sendMessage } from '../../services/bookings/gmailClient';
import { createEmailTemplate, updateEmailTemplate, listEmailTemplates, renderBookingEmailPreview, sendBookingEmail, getBookingEmailTemplateGallery } from '../bookingController';
const request = (body: object = {}) => ({ body, params: {}, query: {}, authContext: { id: 215, userTypeId: 16 } } as AuthenticatedRequest);
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response);
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue([3]);
  jest.mocked(getBookingEmailAccess).mockResolvedValue({ customerEmail: 'guest@example.com', booking: { id: 12 }, productTypeIds: [3], messageIds: [], threadIds: [] } as any);
});
afterEach(() => jest.restoreAllMocks());

it('shows the saved product meeting photo in the storefront confirmation gallery without sending an email', async () => {
  jest.mocked(EmailTemplate.findAll).mockResolvedValue([]);
  jest.spyOn(Product, 'findByPk').mockResolvedValue({ id: 28, storefrontConfig: { content: { meetingPoint: {
    name: 'Configured meeting point', photoUrl: 'https://media.example.com/current-meeting.jpg', photoAlt: 'Statue & umbrella',
  } } } } as Product);
  const res = response();
  await getBookingEmailTemplateGallery(request(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  const gallery = (res.json as jest.Mock).mock.calls[0][0];
  const preview = gallery.previews.find((item: { id: string }) => item.id === 'system-omni-storefront-confirmation');
  expect(preview.htmlBody).toContain('src="https://media.example.com/current-meeting.jpg"');
  expect(preview.htmlBody).toContain('alt="Statue &amp; umbrella"');
  expect(preview.htmlBody).toContain('Configured meeting point');
  expect(preview.htmlBody).toContain('src="data:image/png;base64,');
  expect(preview.htmlBody).not.toContain('src="cid:');
  expect(preview.textBody).toContain('Meeting point photo: https://media.example.com/current-meeting.jpg');
  expect(sendMessage).not.toHaveBeenCalled();
});
it('lists only this product type’s non-executable templates', async () => {
  jest.mocked(EmailTemplate.findAll).mockResolvedValue([]);
  const res = response(); await listEmailTemplates(request(), res);
  expect(EmailTemplate.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ productTypeId: expect.anything(), templateType: 'plain_text' }) }));
  expect(res.status).toHaveBeenCalledWith(200);
});
it('creates a product-owned template, ignoring a forged global scope', async () => {
  const template = { save: jest.fn() } as unknown as EmailTemplate;
  jest.mocked(EmailTemplate.findOne).mockResolvedValue(null);
  jest.mocked(EmailTemplate.build).mockReturnValue(template);
  const res = response();
  await createEmailTemplate(request({ name: 'Food follow-up', templateType: 'plain_text', subjectTemplate: 'Hi {{customerName}}', bodyTemplate: 'See you soon', productTypeId: null }), res);
  expect(template.productTypeId).toBe(3);
  expect(template.createdBy).toBe(215);
  expect(template.save).toHaveBeenCalledTimes(1);
  expect(res.status).toHaveBeenCalledWith(201);
});
it.each([null, 1])('does not permit editing a global/other-product template (%s)', async productTypeId => {
  const template = { productTypeId, templateType: 'plain_text', save: jest.fn() } as unknown as EmailTemplate;
  jest.mocked(EmailTemplate.findByPk).mockResolvedValue(template);
  const req = request({ bodyTemplate: 'Replace company template' }); req.params.templateId = '2';
  const res = response(); await updateEmailTemplate(req, res);
  expect(res.status).toHaveBeenCalledWith(403); expect(template.save).not.toHaveBeenCalled();
});
it('allows updating own template text without changing ownership', async () => {
  const template = { productTypeId: 3, templateType: 'plain_text', save: jest.fn() } as unknown as EmailTemplate;
  jest.mocked(EmailTemplate.findByPk).mockResolvedValue(template);
  const req = request({ bodyTemplate: 'New text', productTypeId: 1 }); req.params.templateId = '2';
  const res = response(); await updateEmailTemplate(req, res);
  expect(res.status).toHaveBeenCalledWith(200); expect(template.bodyTemplate).toBe('New text'); expect(template.productTypeId).toBe(3);
});
it('rejects executable templates and executable preview source', async () => {
  const res = response();
  await createEmailTemplate(request({ templateType: 'react_email' }), res);
  expect(res.status).toHaveBeenCalledWith(403);
  const preview = response();
  await renderBookingEmailPreview(request({ to: 'guest@example.com', subject: 'Test', body: 'Test', templateContext: { reactTemplateSource: 'process.env' } }), preview);
  expect(preview.status).toHaveBeenCalledWith(403);
});
it('renders booking placeholders in an own plain-text template', async () => {
  jest.mocked(EmailTemplate.findByPk).mockResolvedValue({ productTypeId: 3, templateType: 'plain_text', isActive: true, subjectTemplate: 'Hello {{customerName}}', bodyTemplate: 'Your tour is {{productName}}' } as EmailTemplate);
  const res = response();
  await renderBookingEmailPreview(request({ to: 'guest@example.com', templateId: 1, templateContext: { customerName: 'Guest', productName: 'Food Tour' } }), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Hello Guest', textBody: 'Your tour is Food Tour' }));
});
it('rejects an arbitrary recipient before sending anything', async () => {
  const res = response(); await sendBookingEmail(request({ to: 'other@example.com', subject: 'Test', body: 'Test' }), res);
  expect(res.status).toHaveBeenCalledWith(403); expect(sendMessage).not.toHaveBeenCalled();
});
it('resolves meeting-point photo placeholders from the authorized booking product', async () => {
  jest.spyOn(Booking, 'findByPk').mockResolvedValue({ id: 12, productId: 9 } as Booking);
  jest.spyOn(Product, 'findByPk').mockResolvedValue({ storefrontConfig: { content: { meetingPoint: {
    name: 'Main square', photoUrl: 'https://media.example.com/meeting.jpg', photoAlt: 'Guide beside the statue',
  } } } } as Product);
  jest.mocked(EmailTemplate.findByPk).mockResolvedValue({ productTypeId: 3, templateType: 'plain_text', isActive: true,
    subjectTemplate: 'Meeting point', bodyTemplate: '{{meetingPointPhotoAlt}}: {{meetingPointPhotoUrl}}',
  } as EmailTemplate);
  const req = request({ to: 'guest@example.com', templateId: 1,
    templateContext: { meetingPointPhotoUrl: 'https://wrong.example.com/photo.jpg' } });
  req.query.bookingId = '12';
  const res = response();
  await renderBookingEmailPreview(req, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    textBody: 'Guide beside the statue: https://media.example.com/meeting.jpg',
  }));
  expect(Product.findByPk).toHaveBeenCalledWith(9);
  expect(sendMessage).not.toHaveBeenCalled();
});
