import { sanitizeCerebroRichText } from './cerebroRichTextSanitize';

describe('sanitizeCerebroRichText', () => {
  it('wraps rendered tables in a keyboard-accessible horizontal scroll region', () => {
    const result = sanitizeCerebroRichText(
      '<table><tbody><tr><td>A wide value</td><td>Another value</td></tr></tbody></table>',
    );
    const container = document.createElement('div');
    container.innerHTML = result;

    const wrapper = container.querySelector('.cerebro-table-scroll');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute('role')).toBe('region');
    expect(wrapper?.getAttribute('tabindex')).toBe('0');
    expect(wrapper?.querySelector('table')).not.toBeNull();
  });

  it('keeps long links safe for opening outside the application', () => {
    const result = sanitizeCerebroRichText('<p><a href="https://example.com/very-long-link">Link</a></p>');
    const container = document.createElement('div');
    container.innerHTML = result;
    const link = container.querySelector('a');

    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer noopener');
  });
});
