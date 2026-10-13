import {
  APPLICATION_RUNTIME_MODES,
  resolveApplicationRuntimeMode,
} from './applicationRuntimeMode.js';
import { isPromotionTrackingServerEnabled } from './promotionTrackingFeature.js';

export type PromotionTrackingModelPolicy = Readonly<{
  includeReadModels: boolean;
  includeLiveModels: boolean;
}>;

export const buildPromotionTrackingModelPolicy = (
  env: NodeJS.ProcessEnv = process.env,
): PromotionTrackingModelPolicy => {
  const runtimeMode = resolveApplicationRuntimeMode(env.APP_RUNTIME_MODE);
  const isDryRun = runtimeMode === APPLICATION_RUNTIME_MODES.dryRun;
  const includeLiveModels = isPromotionTrackingServerEnabled(env) && !isDryRun;

  return Object.freeze({
    includeReadModels: isDryRun || includeLiveModels,
    includeLiveModels,
  });
};
