import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { render, screen, fireEvent } from '@testing-library/react';
import { StructuredJsonEditor } from './StructuredJsonEditor';
function setup(initial: string) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = jest
    .fn()
    .mockImplementation(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
  const changed = jest.fn(),
    errors = jest.fn();
  function Example() {
    const [value, setValue] = useState(initial);
    return (
      <MantineProvider>
        <StructuredJsonEditor
          value={value}
          onChange={(next) => {
            changed(next);
            setValue(next);
          }}
          onError={errors}
        />
      </MantineProvider>
    );
  }
  render(<Example />);
  return { changed, errors };
}
test('form edits and JSON mode stay synchronized without rounding other values', () => {
  const { changed } = setup('{"retry":1,"id":9007199254740993}');
  fireEvent.change(screen.getByLabelText('Value of $.retry'), {
    target: { value: '12' },
  });
  expect(changed.mock.calls.at(-1)?.[0]).toContain('9007199254740993');
  fireEvent.click(screen.getByRole('button', { name: 'JSON', exact: true }));
  expect((screen.getByLabelText('JSON value') as HTMLTextAreaElement).value).toContain('"retry": 12');
  fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
  expect(changed.mock.calls.at(-1)?.[0]).toBe(
    '{"retry":1,"id":9007199254740993}',
  );
});
test('incomplete numeric drafts remain editable and block saving until corrected', () => {
  const { errors } = setup('{"retry":1}');
  const input = screen.getByLabelText('Value of $.retry');
  fireEvent.change(input, { target: { value: '1e' } });
  expect(input).toHaveValue('1e');
  expect(errors.mock.calls.at(-1)?.[0]).toBeTruthy();
  fireEvent.change(input, { target: { value: '1e2' } });
  expect(errors.mock.calls.at(-1)?.[0]).toBeNull();
});
test('an empty replacement does not automatically overwrite a setting with an empty object', () => {
  const { changed } = setup('');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Start an object' }));
  expect(changed).toHaveBeenCalledWith('{}');
});
