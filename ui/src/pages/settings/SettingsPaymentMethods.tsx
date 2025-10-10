import { Stack, Title, Text } from "@mantine/core";
import PaymentMethodsList from "../../components/paymentMethods/PaymentMethodsList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsPaymentMethods;

const SettingsPaymentMethods = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Payment Methods</Title>
          <Text size="sm" c="dimmed">
            Define the payment options your team can assign to channels.
          </Text>
        </div>
        <PaymentMethodsList pageTitle="Payment Methods" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsPaymentMethods;
