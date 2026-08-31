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
});
