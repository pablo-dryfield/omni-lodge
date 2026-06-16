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

        <Text fw={600}>Include the following in your request:</Text>
        <List spacing="xs">
          <List.Item>Your name</List.Item>
          <List.Item>Your phone number</List.Item>
          <List.Item>Details of your request</List.Item>
        </List>

        <Text style={{ lineHeight: 1.75 }}>
          We will process deletion requests within 30 days where applicable.
        </Text>
      </Stack>
    </LegalPageLayout>
  );
};

export default DataDeletionPage;
