import { Anchor, List, Stack, Text } from "@mantine/core";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import LegalPageLayout from "../components/legal/LegalPageLayout";

const DataDeletionPage = ({ title }: GenericPageProps) => {
  return (
    <LegalPageLayout
      eyebrow="Legal"
      title={title}
      description="Use this page to request deletion of personal data from OmniLodge systems."
    >
      <Stack gap="md">
        <Text style={{ lineHeight: 1.75 }}>
          If you would like your personal data deleted from OmniLodge systems, please email:{" "}
          <Anchor href="mailto:pjcampoo@hotmail.com">pjcampoo@hotmail.com</Anchor>
        </Text>

        <Text style={{ lineHeight: 1.75 }}>
          This process is available to OmniLodge users, WhatsApp participants whose conversations,
          including outbound message echoes, were processed through a business&apos;s connected WhatsApp
          number, and administrators of that connected business. The normalized WhatsApp message
          store uses a configurable retention window of one to seven days, measured from each
          message&apos;s timestamp, with an hourly purge of records after they leave that window.
        </Text>

        <Text fw={600}>Include the following in your request:</Text>
        <List spacing="xs">
          <List.Item>Your name</List.Item>
          <List.Item>The phone number or OmniLodge account associated with the data</List.Item>
          <List.Item>For a WhatsApp request, the connected business number you contacted and the approximate date of the conversation</List.Item>
          <List.Item>Details of your request</List.Item>
        </List>

        <Text style={{ lineHeight: 1.75 }}>
          Please do not email passwords, verification codes, access tokens, or a full copy of your
          message history. We may ask for limited additional information to verify that the request
          relates to you or that you are authorized to act for the connected business.
        </Text>

        <Text style={{ lineHeight: 1.75 }}>
          We will acknowledge and process verified deletion requests within 30 days where applicable.
          Information that must be retained for security, legal, or fraud-prevention purposes may be
          kept only for the required period.
        </Text>
      </Stack>
    </LegalPageLayout>
  );
};

export default DataDeletionPage;
