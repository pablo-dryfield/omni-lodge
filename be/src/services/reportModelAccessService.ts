const SENSITIVE_REPORT_MODEL_IDS = new Set([
  'FinanceFile',
  'StaffPayoutReceipt',
  'StaffPayoutReceiptItem',
]);

/**
 * Sensitive evidence models are queried only by purpose-built, role-guarded
 * endpoints. The generic report builder also serves assistant managers, so it
 * must not expose these models or allow them to be referenced by a crafted
 * query configuration.
 */
export const isSensitiveReportModel = (modelId: string): boolean =>
  SENSITIVE_REPORT_MODEL_IDS.has(modelId.trim());

const MODEL_REFERENCE_KEYS = new Set([
  'modelId',
  'leftModel',
  'rightModel',
  'leftModelId',
  'rightModelId',
]);

const MODEL_LIST_KEYS = new Set(['models', 'referencedModels']);

export const listSensitiveReportModelReferences = (value: unknown): string[] => {
  const references = new Set<string>();
  const seen = new Set<object>();

  const visit = (candidate: unknown, parentKey: string | null = null): void => {
    if (typeof candidate === 'string') {
      if ((parentKey && MODEL_REFERENCE_KEYS.has(parentKey)) && isSensitiveReportModel(candidate)) {
        references.add(candidate.trim());
      }
      return;
    }
    if (!candidate || typeof candidate !== 'object') {
      return;
    }
    if (seen.has(candidate)) {
      return;
    }
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => {
        if (
          parentKey
          && MODEL_LIST_KEYS.has(parentKey)
          && typeof entry === 'string'
          && isSensitiveReportModel(entry)
        ) {
          references.add(entry.trim());
          return;
        }
        visit(entry, parentKey);
      });
      return;
    }

    Object.entries(candidate as Record<string, unknown>).forEach(([key, entry]) => {
      visit(entry, key);
    });
  };

  visit(value);
  return Array.from(references).sort();
};
