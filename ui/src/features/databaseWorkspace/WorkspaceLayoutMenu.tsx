import { Button, Menu } from '@mantine/core';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { IconCheck, IconLayoutSidebarLeftCollapse } from '@tabler/icons-react';
export type WorkspaceVisibility = {
  header: boolean;
  quickActions: boolean;
  navigation: boolean;
  explorer: boolean;
};
export const fullWorkspaceVisibility: WorkspaceVisibility = {
  header: true,
  quickActions: true,
  navigation: true,
  explorer: true,
};
const MenuCheckbox = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'>
>((props, ref) => (
  <button
    {...props}
    ref={ref}
    role="menuitemcheckbox"
    aria-checked={props['aria-checked'] ?? false}
    type="button"
  />
));
MenuCheckbox.displayName = 'MenuCheckbox';
export function WorkspaceLayoutMenu({
  value,
  onChange,
  views,
  onView,
}: {
  value: WorkspaceVisibility;
  onChange: (value: WorkspaceVisibility) => void;
  views: readonly (readonly [string, string, ...unknown[]])[];
  onView: (view: string) => void;
}) {
  return (
    <Menu closeOnItemClick={false} position="bottom-end">
      <Menu.Target>
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconLayoutSidebarLeftCollapse size={14} />}
          aria-label="Workspace layout"
        >
          Layout
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Show sections</Menu.Label>
        {(
          [
            ['explorer', 'Object explorer'],
            ['header', 'Connection header'],
            ['quickActions', 'Quick actions'],
            ['navigation', 'Workspace navigation'],
          ] as const
        ).map(([key, label]) => (
          <Menu.Item
            key={key}
            component={MenuCheckbox}
            aria-checked={value[key]}
            leftSection={
              value[key] ? (
                <IconCheck size={14} />
              ) : (
                <span style={{ width: 14 }} />
              )
            }
            onClick={() => onChange({ ...value, [key]: !value[key] })}
          >
            {label}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item
          onClick={() =>
            onChange({
              header: false,
              quickActions: false,
              navigation: false,
              explorer: false,
            })
          }
        >
          Focus on query
        </Menu.Item>
        <Menu.Item onClick={() => onChange(fullWorkspaceVisibility)}>
          Show all sections
        </Menu.Item>
        <Menu.Divider />
        <Menu.Label>Go to view</Menu.Label>
        {views.map(([key, label]) => (
          <Menu.Item key={key} onClick={() => onView(key)}>
            {label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
