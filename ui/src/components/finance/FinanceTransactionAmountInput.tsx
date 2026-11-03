import { useEffect, useRef, useState } from 'react';
import { NumberInput, Text } from '@mantine/core';

type Props = {
  valueMinor: number;
  onChangeMinor: (value: number) => void;
  currency: string;
  className?: string;
  currencyClassName?: string;
  autoFocus?: boolean;
};

export default function FinanceTransactionAmountInput({
  valueMinor, onChangeMinor, currency, className, currencyClassName, autoFocus,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [editingValue, setEditingValue] = useState<string | number>(valueMinor / 100);
  const lastEmittedMinor = useRef(valueMinor);

  useEffect(() => {
    // Restored drafts and switching transactions can change the amount externally.
    // Preserve transient decimal text while the parent acknowledges our own edits.
    if (valueMinor !== lastEmittedMinor.current) {
      setEditingValue(valueMinor / 100);
      lastEmittedMinor.current = valueMinor;
    }
  }, [valueMinor]);

  const updateEditingValue = (value: string) => {
    setEditingValue(value);
    const minor = Math.round((Number(value) || 0) * 100);
    lastEmittedMinor.current = minor;
    onChangeMinor(minor);
  };

  // Focus capture starts editing immediately; the formatter defers onFocus.
  return (
    <NumberInput
      className={className}
      label="Amount"
      aria-label="Transaction amount"
      inputMode="decimal"
      value={editingValue}
      valueIsNumericString
      min={0}
      allowNegative={false}
      decimalScale={2}
      fixedDecimalScale={!focused}
      allowedDecimalSeparators={['.', ',']}
      placeholder="0.00"
      hideControls
      autoFocus={autoFocus}
      rightSection={<Text className={currencyClassName}>{currency}</Text>}
      rightSectionWidth={58}
      onFocusCapture={() => {
        setFocused(true);
        setEditingValue(valueMinor === 0 ? '' : String(valueMinor / 100));
      }}
      onBlur={() => {
        setFocused(false);
        setEditingValue(valueMinor / 100);
      }}
      onValueChange={(values, source) => {
        if (source.source !== 'event') return;
        updateEditingValue(values.value);
      }}
      onPaste={event => {
        const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
        if (!text.includes(',')) return;
        // The formatter otherwise strips pasted commas, turning 120,45 into 12045.
        event.preventDefault();
        let normalized: string;
        if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(text)) normalized = text.replace(/,/g, '');
        else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text)) normalized = text.replace(/\./g, '').replace(',', '.');
        else if (/^\d*(?:,\d{0,2})?$/.test(text)) normalized = text.replace(',', '.');
        else return;
        const input = event.currentTarget;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const next = input.value.slice(0, start) + normalized + input.value.slice(end);
        if (/^\d*(?:\.\d{0,2})?$/.test(next)) updateEditingValue(next);
      }}
      withAsterisk
    />
  );
}
