import { normalizeTemplateTimeInput } from './assistantManagerTaskTimeUtils';

describe('normalizeTemplateTimeInput', () => {
  it.each([
    ['20:40', '20:40'],
    ['08:00', '08:00'],
    ['8:00', '08:00'],
    ['8:00 AM', '08:00'],
    ['8:00 PM', '20:00'],
    ['20:40:00', '20:40'],
  ])('normalizes valid task template time %s', (input, expected) => {
    expect(normalizeTemplateTimeInput(input)).toBe(expected);
  });

  it.each(['24:00', '20:60', '8:00 XM', 'not a time'])('rejects invalid time %s', (input) => {
    expect(normalizeTemplateTimeInput(input)).toBeNull();
  });

  it('treats an empty value as unset', () => {
    expect(normalizeTemplateTimeInput('   ')).toBeNull();
  });
});
