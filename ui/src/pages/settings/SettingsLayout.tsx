import React, { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Stack, Title, Text } from "@mantine/core";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { navigateToPage } from "../../actions/navigationActions";

const SettingsLayout = () => {
  const dispatch = useAppDispatch();
  const workspace = useLocation().pathname.replace(/\/$/, '') === '/settings/sql-helper';
  const productScoped = useAppSelector(state => (state.accessControl.productTypeIds?.length ?? 0) > 0);

  useEffect(() => {
    dispatch(navigateToPage("Settings"));
  }, [dispatch]);

  return (
    <Stack gap="lg">
      {!workspace && <div>
        <Title order={2}>{productScoped ? 'Product settings' : 'Control Panel'}</Title>
        <Text size="sm" c="dimmed">
          {productScoped ? 'Manage your product catalog and exclusively assigned team. Company-wide administration remains restricted.' : 'Manage people access, navigation structure, and module permissions.'}
        </Text>
      </div>}
      <Outlet />
    </Stack>
  );
};

export default SettingsLayout;
