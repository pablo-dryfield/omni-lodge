export type LoginRedirectLocation = {
  pathname: string;
  search?: string;
  hash?: string;
};

const DEFAULT_AUTHENTICATED_DESTINATION = '/';
const AFFILIATE_DESTINATION = '/affiliates';

const buildSafeInternalDestination = ({
  pathname,
  search = '',
  hash = '',
}: LoginRedirectLocation): string => {
  // The destination is derived from the active BrowserRouter location, not a
  // query-string redirect. Keep the validation here so this helper remains
  // safe if a caller later passes user-controlled input.
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\')) {
    return DEFAULT_AUTHENTICATED_DESTINATION;
  }

  const safeSearch = search === '' || search.startsWith('?') ? search : '';
  const safeHash = hash === '' || hash.startsWith('#') ? hash : '';

  return `${pathname}${safeSearch}${safeHash}`;
};

export const getPostLoginDestination = (
  roleSlug: string | null | undefined,
  location: LoginRedirectLocation,
): string => {
  if (String(roleSlug ?? '').trim().toLowerCase() === 'affiliate') {
    return AFFILIATE_DESTINATION;
  }

  return buildSafeInternalDestination(location);
};
