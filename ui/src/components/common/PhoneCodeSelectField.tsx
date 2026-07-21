import React, { useEffect, useMemo, useState } from "react";
import { Select } from "@mantine/core";

import { PHONE_CODE_OPTIONS } from "../../constants/phoneCodes";

type PhoneCodeSelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  textAlign?: React.CSSProperties["textAlign"];
  required?: boolean;
};

const buildPhoneCodeOptionId = (option: { value: string; iso2: string }) => `${option.value}|${option.iso2}`;

const getPhoneCodeFromOptionId = (optionId: string) => optionId.split("|")[0] ?? optionId;

const findPhoneCodeOptionId = (code: string) => {
  const option = PHONE_CODE_OPTIONS.find((item) => item.value === code);
  return option ? buildPhoneCodeOptionId(option) : null;
};

const PhoneCodeSelectField: React.FC<PhoneCodeSelectFieldProps> = ({
  label,
  value,
  onChange,
  placeholder = "Select code",
  textAlign = "left",
  required = false,
}) => {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(() => findPhoneCodeOptionId(value));

  useEffect(() => {
    if (!value) {
      setSelectedOptionId(null);
      return;
    }
    const selectedCode = selectedOptionId ? getPhoneCodeFromOptionId(selectedOptionId) : null;
    if (selectedCode !== value) {
      setSelectedOptionId(findPhoneCodeOptionId(value));
    }
  }, [selectedOptionId, value]);

  const data = useMemo(
    () =>
      PHONE_CODE_OPTIONS.map((option) => ({
        value: buildPhoneCodeOptionId(option),
        label: option.label,
      })),
    [],
  );

  const handleSelect = (optionId: string | null) => {
    setSelectedOptionId(optionId);
    onChange(optionId ? getPhoneCodeFromOptionId(optionId) : "");
  };

  return (
    <Select
      label={label}
      placeholder={placeholder}
      data={data}
      value={selectedOptionId}
      onChange={handleSelect}
      searchable
      nothingFoundMessage="No matches"
      checkIconPosition="right"
      withAsterisk={required}
      aria-required={required || undefined}
      maxDropdownHeight={220}
      styles={{
        input: { textAlign },
        option: { textAlign },
      }}
      style={{ width: "100%" }}
    />
  );
};

export default PhoneCodeSelectField;
