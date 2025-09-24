import React, { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Stack, Title, Text } from "@mantine/core";
import { useAppDispatch } from "../../store/hooks";
import { navigateToPage } from "../../actions/navigationActions";

const SettingsLayout = () => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(navigateToPage("Settings"));
  }, [dispatch]);

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Control Panel</Title>
        <Text size="sm" c="dimmed">
          Manage people access, navigation structure, and module permissions.
        </Text>
      </div>
      <Outlet />
    </Stack>
  );
};

export default SettingsLayout;
