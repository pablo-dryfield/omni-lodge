jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/EmailTemplate.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), findByPk: jest.fn(), build: jest.fn() } }));
jest.mock('../../services/productScopeService.js', () => ({ getAllowedProductTypeIds: jest.fn() }));
jest.mock('../../services/bookingEmailScopeService.js', () => ({ ...jest.requireActual('../../services/bookingEmailScopeService.js'), getBookingEmailAccess: jest.fn() }));
jest.mock('../../services/bookings/gmailClient.js', () => ({ sendMessage: jest.fn(), fetchMessagePayload: jest.fn() }));
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import EmailTemplate from '../../models/EmailTemplate';
import { getAllowedProductTypeIds } from '../../services/productScopeService';
import { getBookingEmailAccess } from '../../services/bookingEmailScopeService';
import { sendMessage } from '../../services/bookings/gmailClient';
import { createEmailTemplate, updateEmailTemplate, listEmailTemplates, renderBookingEmailPreview, sendBookingEmail } from '../bookingController';
const request = (body: object = {}) => ({ body, params: {}, query: {}, authContext: { id: 215, userTypeId: 16 } } as AuthenticatedRequest);
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response);
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue([3]);
  jest.mocked(getBookingEmailAccess).mockResolvedValue({ customerEmail: 'guest@example.com', booking: { id: 12 }, productTypeIds: [3], messageIds: [], threadIds: [] } as any);
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
