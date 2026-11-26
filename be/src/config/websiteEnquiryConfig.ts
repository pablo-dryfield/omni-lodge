import type { ConfigDefinition } from './appConfigRegistry.js';
import { KTK_WEBSITE_FORMS } from './ktkWebsiteForms.js';

export const WEBSITE_ENQUIRY_CONFIG_KEYS = [
  'STAGING_WEBSITE_ENQUIRY_ENABLED',
  'STAGING_WEBSITE_ENQUIRY_SIGNING_SECRET',
  'STAGING_WEBSITE_ENQUIRY_RECIPIENTS',
  'STAGING_WEBSITE_ENQUIRY_RATE_LIMIT',
  'STOREFRONT_EMAIL_FROM_ADDRESS',
  'STOREFRONT_EMAIL_FROM_NAME',
] as const;

export const WEBSITE_ENQUIRY_CONFIG: ConfigDefinition[] = [
  {
    key: 'STAGING_CUSTOMER_ENQUIRY_REMOVAL_ENABLED', label: 'KTK staging enquiry contents removal enabled', category: 'Website enquiries',
    description: 'Disabled by default. Permits separately authorised inbox users to remove contents only after an exact preview and explicit confirmation. Does not delete Gmail, backups, exports, bookings or delivery deduplication identities. Preview works while disabled. Changes apply on the next request; enabling requires the owner-approved real-data removal process.',
    valueType: 'boolean', defaultValue: false, impact: 'high',
  },
  {
    key: 'STAGING_WEBSITE_ENQUIRY_ENABLED', label: 'KTK staging enquiry delivery enabled', category: 'Website enquiries',
    description: 'Allow only the signed KTK staging enquiry endpoint. Disabled by default. Does not enable production website forms or alter order emails. Changes apply on the next request.',
    valueType: 'boolean', defaultValue: false, impact: 'high',
  },
  {
    key: 'STAGING_WEBSITE_ENQUIRY_SIGNING_SECRET', label: 'KTK staging enquiry signing secret', category: 'Website enquiries',
    description: 'Dedicated server-to-server HMAC secret shared with the staging WordPress server only, at least 32 characters. Never put it in public frontend settings or reuse payment credentials. Changes apply on the next request.',
    valueType: 'string', defaultValue: null, isSecret: true, impact: 'high', validation: { minLength: 32, maxLength: 256 },
  },
  {
    key: 'STAGING_WEBSITE_ENQUIRY_RECIPIENTS', label: 'KTK staging enquiry recipients', category: 'Website enquiries',
    description: 'Object keyed by the seven code-owned form IDs, each with to and cc email arrays. Public callers cannot choose recipients. Existing Student Trips info recipient and group activities CC are retained by default. Changes apply on the next request.',
    valueType: 'json', defaultValue: JSON.stringify(Object.fromEntries(KTK_WEBSITE_FORMS.forms.map(form => [form.id, form.recipients]))),
    impact: 'high', validation: { maxLength: 6000 },
  },
  {
    key: 'STAGING_WEBSITE_ENQUIRY_RATE_LIMIT', label: 'KTK staging enquiry requests per minute', category: 'Website enquiries',
    description: 'Maximum requests per source IP per minute on the separate staging integration endpoint. WordPress also retains its own per-form visitor rate limit. No effect on paid checkout or order emails.',
    valueType: 'number', defaultValue: 60, impact: 'medium', validation: { integer: true, min: 1, max: 300 },
  },
];
