import {
  ActionIcon,
  Button,
  Divider,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { StorefrontProductConfig } from "../../types/products/Product";
import type {
  StorefrontAddonConfig,
  StorefrontAddonOption,
} from "../../types/productAddons/ProductAddon";

type ProductRulesProps = {
  value: StorefrontProductConfig;
  onChange: (value: StorefrontProductConfig) => void;
};

export const ProductStorefrontRulesEditor = ({ value, onChange }: ProductRulesProps) => {
  const update = <K extends keyof StorefrontProductConfig>(
    key: K,
    nextValue: StorefrontProductConfig[K],
  ) => onChange({ ...value, [key]: nextValue });

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <div>
          <Text fw={600}>Storefront booking rules</Text>
          <Text size="sm" c="dimmed">
            Control what guests choose and which details are required at checkout.
          </Text>
        </div>
        <Divider />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Participant input"
            description="Use one total or separate counts by gender."
            data={[
              { value: "quantity", label: "Total quantity" },
              { value: "gender_split", label: "Women and men separately" },
            ]}
            value={value.participantMode ?? "quantity"}
            allowDeselect={false}
            onChange={(next) =>
              update("participantMode", next as StorefrontProductConfig["participantMode"])
            }
          />
          <Group grow align="flex-start">
            <NumberInput
              label="Minimum guests"
              min={0}
              allowDecimal={false}
              value={value.minParticipants ?? ""}
              placeholder="No minimum"
              onChange={(next) =>
                update("minParticipants", next === "" ? undefined : Number(next))
              }
            />
            <NumberInput
              label="Maximum guests"
              min={1}
              allowDecimal={false}
              value={value.maxParticipants ?? ""}
              placeholder="No maximum"
              onChange={(next) =>
                update("maxParticipants", next === "" ? undefined : Number(next))
              }
            />
          </Group>
        </SimpleGrid>
        <Switch
          label="Require booking date"
          description="Guests must select a date before adding this product to the cart."
          checked={value.dateRequired === true}
          onChange={(event) => update("dateRequired", event.currentTarget.checked)}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Start-time selection"
            data={[
              { value: "fixed", label: "One fixed time" },
              { value: "select", label: "Choose from a list" },
              { value: "manual", label: "Guest enters a time" },
            ]}
            value={value.timeMode ?? "manual"}
            allowDeselect={false}
            onChange={(next) =>
              update("timeMode", next as StorefrontProductConfig["timeMode"])
            }
          />
          {value.timeMode === "fixed" && (
            <TextInput
              type="time"
              label="Fixed start time"
              value={value.defaultStartTime ?? ""}
              onChange={(event) => update("defaultStartTime", event.currentTarget.value)}
            />
          )}
        </SimpleGrid>
        {value.timeMode === "select" && (
          <TagsInput
            label="Available start times"
            description="Type a time such as 10:00 and press Enter."
            placeholder="Add a start time"
            value={value.startTimes ?? []}
            onChange={(times) => update("startTimes", times)}
            splitChars={[",", " "]}
          />
        )}
        <Divider label="Guest details" labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Switch
            label="Require full name"
            checked={value.fullNameRequired === true}
            onChange={(event) => update("fullNameRequired", event.currentTarget.checked)}
          />
          <Switch
            label="Require email"
            checked={value.emailRequired === true}
            onChange={(event) => update("emailRequired", event.currentTarget.checked)}
          />
          <Switch
            label="Require phone"
            checked={value.phoneRequired === true}
            onChange={(event) => update("phoneRequired", event.currentTarget.checked)}
          />
        </SimpleGrid>
      </Stack>
    </Paper>
  );
};

type AddonRulesProps = {
  value: StorefrontAddonConfig;
  onChange: (value: StorefrontAddonConfig) => void;
};

const emptyOption = (): StorefrontAddonOption => ({ value: "", label: "" });

export const AddonStorefrontRulesEditor = ({ value, onChange }: AddonRulesProps) => {
  const mode = value.selectionMode ?? "boolean";
  const quantities = value.allowedQuantities ?? [];
  const prices = value.quantityPrices ?? {};
  const options = value.options ?? [];

  const updateOption = (index: number, patch: Partial<StorefrontAddonOption>) => {
    onChange({
      ...value,
      options: options.map((option, optionIndex) =>
        optionIndex === index ? { ...option, ...patch } : option,
      ),
    });
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <div>
          <Text fw={600}>Storefront selection rules</Text>
          <Text size="sm" c="dimmed">
            Choose how guests add this extra during checkout.
          </Text>
        </div>
        <Divider />
        <Select
          label="Selection style"
          data={[
            { value: "boolean", label: "Simple yes / no" },
            { value: "quantity", label: "Choose specific quantities" },
            { value: "range", label: "Quantity range" },
            { value: "options", label: "Choose from named options" },
          ]}
          value={mode}
          allowDeselect={false}
          onChange={(next) => {
            const nextMode = next as StorefrontAddonConfig["selectionMode"];
            onChange({
              ...value,
              selectionMode: nextMode,
              ...(nextMode === "quantity" && quantities.length === 0
                ? { allowedQuantities: [1] }
                : {}),
              ...(nextMode === "range"
                ? {
                    minQuantity: value.minQuantity ?? 1,
                    maxQuantity: value.maxQuantity ?? Math.max(value.minQuantity ?? 1, 1),
                  }
                : {}),
            });
          }}
        />

        {mode === "quantity" && (
          <>
            <TagsInput
              label="Allowed quantities"
              description="Enter each permitted quantity and press Enter, for example 1, 3, 5."
              placeholder="Add quantity"
              value={quantities.map(String)}
              onChange={(items) => {
                const normalized = Array.from(
                  new Set(
                    items
                      .map(Number)
                      .filter((item) => Number.isInteger(item) && item > 0),
                  ),
                ).sort((a, b) => a - b);
                const nextPrices = Object.fromEntries(
                  Object.entries(prices).filter(([quantity]) =>
                    normalized.includes(Number(quantity)),
                  ),
                );
                onChange({
                  ...value,
                  allowedQuantities: normalized,
                  quantityPrices: nextPrices,
                });
              }}
              splitChars={[",", " "]}
            />
            {quantities.length > 0 && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>Optional bundle prices</Text>
                <Text size="xs" c="dimmed">
                  Set a total price for a quantity, or leave it blank to use normal pricing.
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  {quantities.map((quantity) => (
                    <NumberInput
                      key={quantity}
                      label={`${quantity} units`}
                      min={0}
                      decimalScale={2}
                      placeholder="Default pricing"
                      value={prices[String(quantity)] ?? ""}
                      onChange={(next) => {
                        const nextPrices = { ...prices };
                        if (next === "") delete nextPrices[String(quantity)];
                        else nextPrices[String(quantity)] = Number(next);
                        onChange({ ...value, quantityPrices: nextPrices });
                      }}
                    />
                  ))}
                </SimpleGrid>
              </Stack>
            )}
          </>
        )}

        {mode === "range" && (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <NumberInput
              label="Minimum quantity"
              description="Smallest quantity a guest can select."
              min={1}
              allowDecimal={false}
              value={value.minQuantity ?? 1}
              onChange={(next) => {
                const minimum = next === "" ? 1 : Math.max(1, Number(next));
                onChange({
                  ...value,
                  minQuantity: minimum,
                  maxQuantity: Math.max(minimum, value.maxQuantity ?? minimum),
                });
              }}
            />
            <NumberInput
              label="Maximum quantity"
              description="Largest quantity a guest can select."
              min={value.minQuantity ?? 1}
              allowDecimal={false}
              value={value.maxQuantity ?? value.minQuantity ?? 1}
              onChange={(next) =>
                onChange({
                  ...value,
                  maxQuantity: Math.max(
                    value.minQuantity ?? 1,
                    next === "" ? value.minQuantity ?? 1 : Number(next),
                  ),
                })
              }
            />
          </SimpleGrid>
        )}

        {mode === "options" && (
          <Stack gap="sm">
            <Group justify="space-between">
              <div>
                <Text size="sm" fw={500}>Options</Text>
                <Text size="xs" c="dimmed">Create the choices shown to guests.</Text>
              </div>
              <Button
                variant="light"
                size="xs"
                leftSection={<IconPlus size={14} />}
                onClick={() => onChange({ ...value, options: [...options, emptyOption()] })}
              >
                Add option
              </Button>
            </Group>
            {options.length === 0 && (
              <Text size="sm" c="dimmed">No options added yet.</Text>
            )}
            {options.map((option, index) => (
              <Paper key={index} withBorder radius="sm" p="sm">
                <Group align="flex-end" wrap="nowrap">
                  <TextInput
                    label="Label"
                    placeholder="e.g. Champagne"
                    value={option.label}
                    style={{ flex: 2 }}
                    onChange={(event) => {
                      const label = event.currentTarget.value;
                      const generatedValue = label
                        .trim()
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/(^-|-$)/g, "");
                      updateOption(index, {
                        label,
                        value: option.value || generatedValue,
                      });
                    }}
                  />
                  <TextInput
                    label="Internal value"
                    placeholder="champagne"
                    value={option.value}
                    style={{ flex: 1.5 }}
                    onChange={(event) => updateOption(index, { value: event.currentTarget.value })}
                  />
                  <NumberInput
                    label="Price"
                    placeholder="Default"
                    min={0}
                    decimalScale={2}
                    value={option.price ?? ""}
                    style={{ flex: 1 }}
                    onChange={(next) =>
                      updateOption(index, { price: next === "" ? undefined : Number(next) })
                    }
                  />
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    size="lg"
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        options: options.filter((_, optionIndex) => optionIndex !== index),
                      })
                    }
                  >
                    <IconTrash size={17} />
                  </ActionIcon>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
};
