import React, { useMemo, useState } from "react";
import { Combobox, InputBase, ScrollArea, Text, useCombobox } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";

import { PHONE_CODE_LOOKUP, PHONE_CODE_OPTIONS } from "../../constants/phoneCodes";

type PhoneCodeSelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

const PhoneCodeSelectField: React.FC<PhoneCodeSelectFieldProps> = ({
  label,
  value,
  onChange,
  placeholder = "Select code",
}) => {
  const [search, setSearch] = useState("");
  const combobox = useCombobox({
    onDropdownClose: () => setSearch(""),
  });

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return PHONE_CODE_OPTIONS;
    }
    return PHONE_CODE_OPTIONS.filter((option) => {
      const normalized = option.label.toLowerCase();
      return (
        normalized.includes(query) ||
        option.value.replace("+", "").includes(query.replace("+", ""))
      );
    });
  }, [search]);

  const selectedLabel = value ? PHONE_CODE_LOOKUP[value]?.label ?? value : null;

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    combobox.closeDropdown();
    setSearch("");
  };

  return (
    <Combobox store={combobox} onOptionSubmit={handleSelect} withinPortal>
      <Combobox.Target>
        <InputBase
          component="button"
          type="button"
          pointer
          onClick={() => combobox.toggleDropdown()}
          rightSection={<IconChevronDown size={16} />}
          rightSectionPointerEvents="none"
          label={label}
          styles={{ input: { textAlign: "left" } }}
          style={{ width: "100%" }}
        >
          {selectedLabel ? (
            <Text size="sm" c="dark">
              {selectedLabel}
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              {placeholder}
            </Text>
          )}
        </InputBase>
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Search
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search by country or code"
          aria-label="Search country calling codes"
        />
        <ScrollArea h={220} scrollHideDelay={0}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <Combobox.Option value={option.value} key={option.value}>
                {option.label}
              </Combobox.Option>
            ))
          ) : (
            <Text size="sm" c="dimmed" px="sm" py="xs">
              No matches
            </Text>
          )}
        </ScrollArea>
      </Combobox.Dropdown>
    </Combobox>
  );
};

export default PhoneCodeSelectField;
