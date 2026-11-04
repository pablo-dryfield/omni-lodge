import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  WorkspaceLayoutMenu,
  fullWorkspaceVisibility,
} from './WorkspaceLayoutMenu';
test('all sections can be toggled and restored through a persistent layout control', async () => {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  const onView = jest.fn();
  function Example() {
    const [value, onChange] = useState(fullWorkspaceVisibility);
    return (
      <MantineProvider>
        <WorkspaceLayoutMenu
          value={value}
          onChange={onChange}
          views={[
            ['query', 'Query'],
            ['objects', 'Objects'],
          ]}
          onView={onView}
        />
      </MantineProvider>
    );
  }
  render(<Example />);
  fireEvent.click(screen.getByRole('button', { name: 'Workspace layout' }));
  const explorer = await screen.findByRole('menuitemcheckbox', {
    name: 'Object explorer',
  });
  fireEvent.click(explorer);
  expect(explorer).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(screen.getByText('Focus on query'));
  for (const control of screen.getAllByRole('menuitemcheckbox'))
    expect(control).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(screen.getByText('Show all sections'));
  for (const control of screen.getAllByRole('menuitemcheckbox'))
    expect(control).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Objects' }));
  expect(onView).toHaveBeenCalledWith('objects');
});
