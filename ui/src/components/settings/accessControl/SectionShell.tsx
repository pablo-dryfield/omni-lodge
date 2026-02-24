import React from "react";
import { Alert, Button, Center, Group, Loader, Stack } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";

type SectionShellProps = {
  permissionsReady: boolean;
  canView: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  refreshDisabled?: boolean;
  children: React.ReactNode;
};

export const SectionShell = ({
  permissionsReady,
  canView,
  loading,
  error,
  onRefresh,
  refreshDisabled,
  children,
}: SectionShellProps) => {
  if (!permissionsReady) {
    return (
      <Center style={{ minHeight: 220 }}>
        <Loader variant="dots" />
      </Center>
    );
  }

  if (!canView) {
    return (
      <Alert color="yellow" title="No access">
        You do not have permission to view this section.
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      {error ? (
        <Alert color="red" title="Error loading data">
          {error}
        </Alert>
      ) : null}
      <Group justify="flex-end">
        <Button
          variant="default"
          leftSection={<IconRefresh size={16} />}
          onClick={onRefresh}
          loading={loading}
          disabled={refreshDisabled}
        >
          Refresh
        </Button>
      </Group>
      {children}
    </Stack>
  );
};

