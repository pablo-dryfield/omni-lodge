export type PromotionBasis = 'booking' | 'person';
export type PromotionScope = 'tour' | 'tour_and_addons';

export const promotionRules = (metadata?: Record<string, unknown> | null) => ({
  applicationBasis: metadata?.applicationBasis === 'person' ? 'person' as const : 'booking' as const,
  discountScope: metadata?.discountScope === 'tour' ? 'tour' as const : 'tour_and_addons' as const,
});

export const supportsEcwidPromotion = (metadata?: Record<string, unknown> | null): boolean => {
  const rules = promotionRules(metadata);
  return rules.applicationBasis === 'booking' && rules.discountScope === 'tour_and_addons';
};

export const requireEcwidPromotionSupport = (metadata?: Record<string, unknown> | null): void => {
  if (!supportsEcwidPromotion(metadata)) {
    throw new Error('Per-person and tour-only discounts cannot be synchronized to Ecwid. Save this code in OmniLodge only.');
  }
};
