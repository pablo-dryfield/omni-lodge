import { useState } from "react";
import { ActionIcon, List, Modal, Text, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

export const AffiliateCommissionRules = ({ rules }: { rules: string[] }) => {
  const [opened, setOpened] = useState(false);
  return <>
    <Tooltip label="Commission eligibility rules">
      <ActionIcon variant="subtle" aria-label="Commission eligibility rules" onClick={() => setOpened(true)}>
        <IconInfoCircle size={20} />
      </ActionIcon>
    </Tooltip>
    <Modal opened={opened} onClose={() => setOpened(false)} title="Commission eligibility rules" centered size="lg">
      {rules.length ? <List spacing="sm" size="sm" withPadding styles={{ root: { listStylePosition: "outside" } }}>
        {rules.map(rule => <List.Item key={rule}>{rule}</List.Item>)}
      </List>
        : <Text size="sm" c="dimmed">The rules could not be loaded. Refresh this page before processing a payout.</Text>}
    </Modal>
  </>;
};
