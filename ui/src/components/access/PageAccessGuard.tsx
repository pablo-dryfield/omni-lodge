import { Alert, Center, Loader, Stack, Text } from "@mantine/core";
import { ReactNode, useMemo } from "react";
import { makeSelectIsPageAllowed } from "../../selectors/accessControlSelectors";
import { useAppSelector } from "../../store/hooks";

type PageAccessGuardProps = {
  pageSlug: string;
  children: ReactNode;
  fallback?: ReactNode;
};

const defaultUnavailable = (message?: string) => (
  <Alert color="red" title="Permissions unavailable">
    <Stack gap={4}>
      <Text size="sm">We could not confirm your access rights.</Text>
      {message && (
        <Text size="sm" c="dimmed">
          {message}
        </Text>
      )}
      <Text size="sm" c="dimmed">
        Please retry syncing permissions or refresh the page.
      </Text>
    </Stack>
  </Alert>
);

const defaultDenied = (
  <Alert color="yellow" title="No access">
    You do not have permission to view this page.
  </Alert>
);

export const PageAccessGuard = ({ pageSlug, children, fallback }: PageAccessGuardProps) => {
  const { loading, loaded, error } = useAppSelector((state) => state.accessControl);
  const selector = useMemo(() => makeSelectIsPageAllowed(pageSlug), [pageSlug]);
  const allowed = useAppSelector(selector);

  if (!loaded) {
    if (loading) {
      return (
        <Center style={{ minHeight: 240 }}>
          <Loader variant="dots" />
        </Center>
      );
    }

    return fallback ?? defaultUnavailable(error ?? undefined);
  }

  if (!allowed) {
    return fallback ?? defaultDenied;
  }

  return <>{children}</>;
};