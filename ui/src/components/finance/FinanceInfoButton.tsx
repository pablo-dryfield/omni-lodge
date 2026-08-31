import { ActionIcon, Popover, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

type FinanceInfoButtonProps = {
  label: string;
  description: string;
};

/** Click/tap help for compact finance labels. */
const FinanceInfoButton = ({ label, description }: FinanceInfoButtonProps) => (
  <Popover
    width={280}
    position="top"
    withArrow
    shadow="md"
    radius="md"
    returnFocus
    middlewares={{ flip: true, shift: { padding: 12 } }}
  >
    <Popover.Target>
      <ActionIcon
        type="button"
        size={32}
        radius="xl"
        variant="light"
        color="gray"
        aria-label={`Information about ${label}`}
        title={`Information about ${label}`}
        style={{ flexShrink: 0 }}
      >
        <IconInfoCircle size={15} stroke={2.2} aria-hidden="true" />
      </ActionIcon>
    </Popover.Target>
    <Popover.Dropdown>
      <Text size="sm" lh={1.45}>{description}</Text>
    </Popover.Dropdown>
  </Popover>
);

export default FinanceInfoButton;
