import { Accordion, Alert, Badge, Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { IconCode, IconWorld } from "@tabler/icons-react";
import { parseAdvancedStorefrontJson } from "./advancedStorefrontConfig";

type Props = {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
};

const AdvancedStorefrontJsonEditor = ({ value, onChange, error }: Props) => (
  <Accordion variant="separated" radius="md">
    <Accordion.Item value="advanced-storefront-json">
      <Accordion.Control icon={<IconCode size={20} />}>
        <Group gap="xs">
          <Text fw={600}>Advanced storefront JSON</Text>
          <Badge size="sm" color={error ? "red" : "blue"} variant="light">
            {error ? "Invalid JSON" : "Public data"}
          </Badge>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="sm">
          <Alert color="blue" icon={<IconWorld size={18} />} title="Shared with your storefronts">
            These additional fields are public in the KTK and Food Tour catalog API.
            Never enter passwords, API keys, or private customer information.
          </Alert>
          <Text size="sm" c="dimmed">
            Add custom fields such as duration, inclusions, or faqs. They are saved directly in
            storefrontConfig, without an extra wrapper. Booking rules and product information
            stay controlled by the form above. Your storefront must support a field to display it.
          </Text>
          <Textarea
            label="Additional storefront fields (JSON)"
            description="Use a JSON object. Remove a field here to delete it; use {} to clear all additional fields."
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            error={error}
            minRows={8}
            maxRows={20}
            autosize
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            styles={{ input: { fontFamily: "monospace", fontSize: 13 } }}
          />
          <Group justify="space-between" gap="xs">
            <Text size="xs" c="dimmed">Storefront access: product.config.yourField</Text>
            <Button
              variant="default"
              size="xs"
              leftSection={<IconCode size={14} />}
              disabled={Boolean(error)}
              onClick={() => onChange(JSON.stringify(parseAdvancedStorefrontJson(value), null, 2))}
            >
              Format JSON
            </Button>
          </Group>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  </Accordion>
);

export default AdvancedStorefrontJsonEditor;
