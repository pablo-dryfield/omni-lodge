import { isPubCrawlGuidingComponentName } from './pubCrawlGuidingReviewTargetRoutingService.js';

type ComponentPolicy = { name: string; config: Record<string, unknown> | null };
const guideConfig = (config: Record<string, unknown> | null | undefined): Record<string, unknown> => {
  const candidate = config?.guideCommission;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown> : {};
};

export const guidingSettlementPolicy = (component: ComponentPolicy) => {
  const legacy = isPubCrawlGuidingComponentName(component.name);
  const config = guideConfig(component.config);
  return {
    legacy,
    enabled: typeof config.settlementComponent === 'boolean' ? config.settlementComponent : legacy,
    reviewTargetRequired: typeof config.reviewTargetRequired === 'boolean' ? config.reviewTargetRequired : legacy,
  };
};

export const validateGuidingSettlementPolicy = (config: Record<string, unknown> | undefined): string | null => {
  const guide = guideConfig(config);
  for (const key of ['settlementComponent', 'reviewTargetRequired']) {
    if (guide[key] !== undefined && typeof guide[key] !== 'boolean') {
      return `guideCommission.${key} must be a boolean`;
    }
  }
  return null;
};

/** New component identities must not rewrite already-settled historical sources. */
export const canAttributeGuidingComponent = (params: {
  legacy: boolean; componentId: number; hasSettlementActivity: boolean; savedSnapshot: unknown;
}): boolean => {
  if (params.legacy || !params.hasSettlementActivity) return true;
  const snapshot = params.savedSnapshot as { sources?: Array<{ sourceKey?: string; componentId?: number }> } | null;
  return Array.isArray(snapshot?.sources) && snapshot.sources.some(source =>
    source && source.sourceKey === 'compensation_component' && source.componentId === params.componentId);
};

export type GuideCommissionMapping = {
  componentId: number;
  productKeys: ReadonlySet<string>;
  preserveLegacyRounding: boolean;
};

/** Assign each earning once, preserving the old regular-crawl cents allocation. */
export const partitionGuideCommission = <T extends { productId: number | null; commission: number }>(
  total: number, entries: readonly T[], mappings: readonly GuideCommissionMapping[],
): Array<{ componentId: number | null; amount: number; entries: T[] }> => {
  const totalMinor = Math.round(total * 100);
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new Error('Invalid guide commission total');
  const owners = new Map<string, GuideCommissionMapping>();
  mappings.forEach(mapping => mapping.productKeys.forEach(key => owners.set(key, mapping)));
  const groups = new Map<number | null, { componentId: number | null; weight: number; entries: T[]; amountMinor: number }>();
  entries.forEach(entry => {
    if (!Number.isFinite(entry.commission) || entry.commission < 0) throw new Error('Invalid guide commission earning');
    const componentId = owners.get(entry.productId === null ? '__null__' : String(entry.productId))?.componentId ?? null;
    const group = groups.get(componentId) ?? { componentId, weight: 0, entries: [], amountMinor: 0 };
    group.weight += entry.commission;
    group.entries.push(entry);
    groups.set(componentId, group);
  });
  let remaining = totalMinor;
  const legacyId = mappings.find(mapping => mapping.preserveLegacyRounding)?.componentId;
  const legacy = legacyId === undefined ? undefined : groups.get(legacyId);
  if (legacy) {
    legacy.amountMinor = Math.min(totalMinor, Math.round(legacy.weight * 100));
    remaining -= legacy.amountMinor;
  }
  const others = [...groups.values()].filter(group => group !== legacy && group.weight > 0);
  const weight = others.reduce((sum, group) => sum + group.weight, 0);
  if (weight > 0) {
    const allocations = others.map(group => {
      const exact = remaining * group.weight / weight;
      group.amountMinor = Math.floor(exact);
      return { group, remainder: exact - group.amountMinor };
    });
    let remainder = remaining - others.reduce((sum, group) => sum + group.amountMinor, 0);
    allocations.sort((a, b) => b.remainder - a.remainder
      || (a.group.componentId ?? Number.MAX_SAFE_INTEGER) - (b.group.componentId ?? Number.MAX_SAFE_INTEGER));
    for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
      allocations[index % allocations.length].group.amountMinor += 1;
    }
  } else if (remaining > 0) {
    const fallback = groups.get(null) ?? { componentId: null, weight: 0, entries: [], amountMinor: 0 };
    fallback.amountMinor += remaining;
    groups.set(null, fallback);
  }
  return [...groups.values()].filter(group => group.amountMinor > 0)
    .map(({ componentId, amountMinor, entries: sourceEntries }) => ({ componentId, amount: amountMinor / 100, entries: sourceEntries }));
};
