import { Stack, Text, Title } from "@mantine/core";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import LegalPageLayout from "../components/legal/LegalPageLayout";

const TermsPage = ({ title }: GenericPageProps) => {
  return (
    <LegalPageLayout
      eyebrow="Legal"
      title={title}
      description="These terms govern access to and use of OmniLodge services and related booking workflows."
    >
      <Stack gap="lg">
        <Stack gap={6}>
          <Title order={3}>Use of Service</Title>
          <Text style={{ lineHeight: 1.75 }}>
            OmniLodge provides booking, operations, and related digital services. By using these services, you agree to use them lawfully and not to misuse, interfere with, or attempt unauthorized access to OmniLodge systems.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>Bookings and Information</Title>
          <Text style={{ lineHeight: 1.75 }}>
            You are responsible for providing accurate booking and contact information. OmniLodge may rely on the information submitted through its website, forms, emails, and connected booking platforms to process reservations and operational requests.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>Payments, Changes, and Refunds</Title>
          <Text style={{ lineHeight: 1.75 }}>
            Payments, amendments, cancellations, and refunds may be subject to the rules of the booking channel used for the reservation, as well as OmniLodge operational policies. Where a third-party platform is involved, its payment and refund handling may also apply.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>Availability and Changes</Title>
          <Text style={{ lineHeight: 1.75 }}>
            OmniLodge may update, suspend, or modify services, product details, pricing, and platform functionality when operationally necessary. Reasonable efforts should be made to keep published information accurate.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>Liability</Title>
          <Text style={{ lineHeight: 1.75 }}>
            To the extent permitted by applicable law, OmniLodge is not liable for indirect, incidental, or consequential losses arising from use of the service, external platform issues, or incomplete third-party data.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>Contact</Title>
          <Text style={{ lineHeight: 1.75 }}>
            For questions related to these terms, contact OmniLodge at pjcampoo@hotmail.com.
          </Text>
        </Stack>
      </Stack>
    </LegalPageLayout>
  );
};

export default TermsPage;
