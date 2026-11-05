type Experience = { productId: number; experienceDate?: string | null; experienceTime?: string | null };

/** One draft selection per resolved product/date/time; later selections replace earlier ones. */
export const latestCartExperiences = <T extends Experience>(items: readonly T[]): T[] => {
  const selections = new Map<string, T>();
  for (const item of items) {
    const key = JSON.stringify([item.productId, item.experienceDate ?? null, item.experienceTime ?? null]);
    selections.set(key, item);
  }
  return [...selections.values()];
};
