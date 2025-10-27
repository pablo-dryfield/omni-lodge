import { useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Badge, Button, Group, Stack, Text, Title } from "@mantine/core";
import { useAppDispatch } from "../../store/hooks";
import { navigateToPage } from "../../actions/navigationActions";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const quickLinks = [
  { label: "Transactions", path: "/finance/transactions" },
  { label: "Accounts", path: "/finance/accounts" },
  { label: "Vendors", path: "/finance/vendors" },
  { label: "Clients", path: "/finance/clients" },
  { label: "Recurring Rules", path: "/finance/recurring" },
  { label: "Management Requests", path: "/finance/management-requests" },
  { label: "Settings", path: "/finance/settings" },
];

const FinanceLayout = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    dispatch(navigateToPage("Finance"));
  }, [dispatch]);

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.finance}>
      <Stack gap="lg">
        <Stack gap="xs">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={2}>Finance</Title>
              <Text size="sm" c="dimmed">
                Track income, expenses, vendors, clients, and approvals in one place.
              </Text>
            </div>
            <Badge color="blue" variant="light" size="lg">
              Finance Hub
            </Badge>
          </Group>
          <Group gap="xs" wrap="wrap">
            {quickLinks.map((link) => {
              const active = location.pathname.startsWith(link.path);
              return (
                <Button
                  key={link.path}
                  variant={active ? "filled" : "light"}
                  color={active ? "blue" : "gray"}
                  onClick={() => navigate(link.path)}
                >
                  {link.label}
                </Button>
              );
            })}
          </Group>
        </Stack>
        <Outlet />
      </Stack>
    </PageAccessGuard>
  );
};

export default FinanceLayout;

