const meridiemTokenPattern = /^(?:a|p)\.?m\.?$/i;
const timeWithoutMeridiemPattern = /^\d{1,2}(?::\d{2})?$/;
const timeWithMeridiemPattern = /\b(?:a|p)\.?m\.?$/i;

const normalizeTagText = (value: string): string => value.trim().replace(/\s+/g, " ");

const isMeridiemToken = (value: string): boolean => meridiemTokenPattern.test(value);

const canAttachMeridiem = (value: string): boolean =>
  timeWithoutMeridiemPattern.test(value) && !timeWithMeridiemPattern.test(value);

export const normalizeStartTimeTags = (tags: readonly string[] = []): string[] => {
  const normalized: string[] = [];

  tags.forEach((tag) => {
    const next = normalizeTagText(tag);
    if (!next) return;

    const previousIndex = normalized.length - 1;
    if (
      previousIndex >= 0
      && isMeridiemToken(next)
      && canAttachMeridiem(normalized[previousIndex])
    ) {
      normalized[previousIndex] = `${normalized[previousIndex]} ${next}`;
      return;
    }

    normalized.push(next);
  });

  return normalized;
};
