import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { injectReducers, type DynamicReducersMap } from "./store";

type LazyRouteModule<TProps = unknown> = {
  default: ComponentType<TProps>;
};

export const lazyRoute = <TProps = unknown>(
  loadModule: () => Promise<LazyRouteModule<TProps>>,
  loadReducers?: () => Promise<DynamicReducersMap>,
): LazyExoticComponent<ComponentType<TProps>> =>
  lazy(async () => {
    const [module, reducers] = await Promise.all([
      loadModule(),
      loadReducers ? loadReducers() : Promise.resolve(undefined),
    ]);

    if (reducers) {
      injectReducers(reducers);
    }

    return module;
  });
