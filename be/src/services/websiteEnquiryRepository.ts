import { UniqueConstraintError } from 'sequelize';
import WebsiteEnquiryDelivery from '../models/WebsiteEnquiryDelivery.js';
import type { EnquiryDeliveryRepository } from './websiteEnquiryService.js';

export const websiteEnquiryRepository: EnquiryDeliveryRepository = {
  async reserve(record) {
    try { await WebsiteEnquiryDelivery.create(record); return true; }
    catch (error) { if (error instanceof UniqueConstraintError) return false; throw error; }
  },
  async find(requestId) { return WebsiteEnquiryDelivery.findByPk(requestId); },
  async markSent(requestId, providerMessageId) {
    const [count] = await WebsiteEnquiryDelivery.update({status: 'sent', providerMessageId, sentAt: new Date()}, {where: {requestId, status: 'sending'}});
    if (count !== 1) throw new Error('Enquiry delivery state changed');
  },
  async markUncertain(requestId) {
    await WebsiteEnquiryDelivery.update({status: 'uncertain'}, {where: {requestId, status: 'sending'}});
  },
};
