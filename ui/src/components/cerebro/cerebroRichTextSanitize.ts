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
  return container.innerHTML;
};
