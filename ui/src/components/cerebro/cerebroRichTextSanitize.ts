import DOMPurify from 'dompurify';
import { normalizeCerebroRichText } from '../../utils/cerebroRichText';

export const sanitizeCerebroRichText = (value: string) => {
  const sanitized = DOMPurify.sanitize(normalizeCerebroRichText(value), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['style'],
  });

  const container = document.createElement('div');
  container.innerHTML = sanitized;
  container.querySelectorAll('a').forEach((anchor) => {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noreferrer noopener');
  });

  // The read-only renderer receives Tiptap's raw HTML, where tables do not
  // have the editor's `.tableWrapper`. Give every table its own scroll region
  // so a wide table never increases the width of the article or page.
  container.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.matches('.cerebro-table-scroll, .tableWrapper')) {
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'cerebro-table-scroll';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Scrollable table');
    wrapper.tabIndex = 0;
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });

  return container.innerHTML;
};
