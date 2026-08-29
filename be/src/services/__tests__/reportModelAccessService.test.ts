import {
  isSensitiveReportModel,
  listSensitiveReportModelReferences,
} from '../reportModelAccessService.js';

describe('report model access', () => {
  it.each([
    'FinanceFile',
    'StaffPayoutReceipt',
    'StaffPayoutReceiptItem',
  ])('blocks sensitive evidence model %s', (modelId) => {
    expect(isSensitiveReportModel(modelId)).toBe(true);
  });

  it('keeps ordinary report models available', () => {
    expect(isSensitiveReportModel('Booking')).toBe(false);
    expect(isSensitiveReportModel('FinanceTransaction')).toBe(false);
  });

  it('finds sensitive references recursively, including unions and joins', () => {
    expect(listSensitiveReportModelReferences({
      models: ['Booking'],
      joins: [{ leftModel: 'Booking', rightModel: 'FinanceFile' }],
      union: {
        queries: [{ select: [{ modelId: 'StaffPayoutReceipt', fieldId: 'id' }] }],
      },
    })).toEqual(['FinanceFile', 'StaffPayoutReceipt']);
  });

  it('does not treat filter values as model references', () => {
    expect(listSensitiveReportModelReferences({
      filters: [{ modelId: 'Booking', fieldId: 'name', value: 'FinanceFile' }],
    })).toEqual([]);
  });
});
