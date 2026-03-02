import { createNamespace, type Namespace } from 'cls-hooked';

const REQUEST_NAMESPACE_NAME = 'omni-request-context';

type RequestContextValue = {
  requestId: string;
  routeKey: string;
  method: string;
  userId?: number | null;
  userTypeId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  roleName?: string | null;
  roleSlug?: string | null;
};

const requestNamespace: Namespace = createNamespace(REQUEST_NAMESPACE_NAME);

export const runInRequestContext = (callback: () => void): void => {
  requestNamespace.run(callback);
};

export const setRequestContextValue = <K extends keyof RequestContextValue>(
  key: K,
  value: RequestContextValue[K],
): void => {
  requestNamespace.set(key, value);
};

export const getRequestContextValue = <K extends keyof RequestContextValue>(
  key: K,
): RequestContextValue[K] | null => {
  const value = requestNamespace.get(key);
  return value == null ? null : (value as RequestContextValue[K]);
};
