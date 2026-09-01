import { CONFIG_DEFINITION_MAP } from './appConfigRegistry';

describe('application configuration registry', () => {
  it('registers the automatic notification inbox polling control', () => {
    expect(CONFIG_DEFINITION_MAP.get('NOTIFICATION_INBOX_POLLING_ENABLED')).toMatchObject({
      category: 'Notifications',
      valueType: 'boolean',
      defaultValue: true,
    });
    expect(CONFIG_DEFINITION_MAP.get('NOTIFICATION_INBOX_POLLING_ENABLED')?.isSecret).not.toBe(true);
  });

  it('registers the public staff badge campaign destination', () => {
    expect(CONFIG_DEFINITION_MAP.get('BADGE_CAMPAIGN_BASE_URL')).toMatchObject({
      category: 'Badge Printing',
      valueType: 'string',
      defaultValue: 'https://krawlthroughkrakow.com/store2/pub-crawl-28/#book',
      impact: 'medium',
      validation: {
        required: true,
        maxLength: 2048,
        format: 'https-url',
      },
    });
    expect(CONFIG_DEFINITION_MAP.get('BADGE_CAMPAIGN_BASE_URL')?.isSecret).not.toBe(true);
  });
});
