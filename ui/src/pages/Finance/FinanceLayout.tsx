import { useEffect } from "react";
import { Navigate, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Select, Stack, useMantineTheme } from "@mantine/core";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { navigateToPage } from "../../actions/navigationActions";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { useMediaQuery } from "@mantine/hooks";
import { IconWallet } from "@tabler/icons-react";
import { FinanceWorkspace } from "../../components/finance/FinanceUi";
import {
  financeNavigationGroups,
  financeNavigationItems,
  isFinanceNavigationItemActive,
} from "../../components/finance/financeNavigation";

const FinanceLayout = () => {
  const dispatch = useAppDispatch();
  const productScoped = useAppSelector(state => (state.accessControl.productTypeIds?.length ?? 0) > 0);
  const navigationGroups = financeNavigationGroups.map(group => ({ ...group,
    items: group.items.filter(item => !productScoped || item.path === '/finance/reports'),
  })).filter(group => group.items.length > 0);
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const activeNavigationItem = financeNavigationItems.find((item) =>
    isFinanceNavigationItemActive(location.pathname, item.path),
  );
  const ActiveNavigationIcon = activeNavigationItem?.icon ?? IconWallet;

  useEffect(() => {
    dispatch(navigateToPage("Finance"));
  }, [dispatch]);

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.finance}>
      <FinanceWorkspace>
        <Stack gap="lg">
          {isMobile ? (
            <Select
              label="Finance section"
              aria-label="Finance section"
              leftSection={<ActiveNavigationIcon size={17} />}
              value={activeNavigationItem?.path ?? "/finance"}
              data={navigationGroups.map((group) => ({
                group: group.label,
                items: group.items.map((item) => ({ value: item.path, label: item.label })),
              }))}
              onChange={(path) => {
                if (path) {
                  navigate(path);
                }
              }}
              allowDeselect={false}
              searchable
            />
          ) : null}
          {productScoped && location.pathname !== '/finance/reports' ? <Navigate to="/finance/reports" replace /> : <Outlet />}
        </Stack>
      </FinanceWorkspace>
    </PageAccessGuard>
  );
};

export default FinanceLayout;



