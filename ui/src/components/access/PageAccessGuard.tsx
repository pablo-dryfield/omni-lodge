import { Center, Loader, Paper, Stack, Text } from "@mantine/core";
import { ReactNode, useMemo } from "react";
import { makeSelectIsPageAllowed } from "../../selectors/accessControlSelectors";
import { useAppSelector } from "../../store/hooks";

type PageAccessGuardProps = {
  pageSlug: string;
  children: ReactNode;
  fallback?: ReactNode;
};

const AlertShell = ({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "red" | "yellow";
  children: ReactNode;
}) => (
  <Paper withBorder radius="md" p="md" shadow="xs" style={{ borderColor: tone === "red" ? "#f03e3e" : "#f59f00" }}>
    <Stack gap={4}>
      <Text fw={600} c={tone} size="sm">
        {title}
      </Text>
      {children}
    </Stack>
  </Paper>
);

const defaultUnavailable = (message?: string) => (
  <AlertShell title="Permissions unavailable" tone="red">
    <Text size="sm">We could not confirm your access rights.</Text>
    {message && (
      <Text size="sm" c="dimmed">
        {message}
      </Text>
    )}
    <Text size="sm" c="dimmed">
      Please retry syncing permissions or refresh the page.
    </Text>
  </AlertShell>
);

const defaultDenied = (
  <AlertShell title="No access" tone="yellow">
    <Text size="sm">You do not have permission to view this page.</Text>
  </AlertShell>
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
