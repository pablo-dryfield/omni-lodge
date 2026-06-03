const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const looksLikeRichHtml = (value: string) => HTML_TAG_PATTERN.test(value);

export const legacyPlainTextToHtml = (value: string) => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  return trimmedValue
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
};

export const normalizeCerebroRichText = (value: string | null | undefined) => {
  const nextValue = value ?? '';
  if (!nextValue.trim()) {
    return '';
  }
  return looksLikeRichHtml(nextValue) ? nextValue : legacyPlainTextToHtml(nextValue);
};

export const richTextToSearchableText = (value: string | null | undefined) => {
  const nextValue = value ?? '';
  if (!looksLikeRichHtml(nextValue)) {
    return nextValue;
  }
  return nextValue
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
};
