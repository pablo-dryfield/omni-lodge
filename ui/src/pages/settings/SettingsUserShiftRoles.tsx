import { Alert, Card, Loader, MultiSelect, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import {
  useShiftRoleAssignments,
  useShiftRoles,
  useUpdateUserShiftRoles,
} from "../../api/shiftRoles";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import type { UserShiftRoleAssignment } from "../../types/shiftRoles/UserShiftRoleAssignment";

const PAGE_SLUG = PAGE_SLUGS.settingsUserShiftRoles;
const MODULE_SLUG = "user-shift-role-directory";

const formatUserName = (assignment: UserShiftRoleAssignment) =>
  `${assignment.firstName ?? ""} ${assignment.lastName ?? ""}`.trim() || `User #${assignment.userId}`;

const SettingsUserShiftRoles = () => {
  const assignmentsQuery = useShiftRoleAssignments();
  const shiftRolesQuery = useShiftRoles();
  const updateMutation = useUpdateUserShiftRoles();
  const moduleAccess = useModuleAccess(MODULE_SLUG);

  const roleOptions = useMemo(() => {
    const roles = shiftRolesQuery.data?.[0]?.data ?? [];
    return roles.map((role) => ({
      value: role.id.toString(),
      label: role.name,
    }));
  }, [shiftRolesQuery.data]);

  const assignments = assignmentsQuery.data?.[0]?.data ?? [];

  const handleChange = (assignment: UserShiftRoleAssignment, values: string[]) => {
    const roleIds = values
      .map((value) => Number(value))
      .filter((value): value is number => Number.isInteger(value));
    void updateMutation.mutateAsync({ userId: assignment.userId, roleIds });
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack mt="lg" gap="lg">
        <Stack gap={4}>
          <Text fw={600}>User shift roles</Text>
          <Text size="sm" c="dimmed">
            Assign shift roles to individual team members. These roles determine which slots they can fill when generating schedules.
          </Text>
        </Stack>

        {shiftRolesQuery.isError ? (
          <Alert color="red" title="Failed to load shift roles">
            {(shiftRolesQuery.error as Error).message}
          </Alert>
        ) : null}

        {assignmentsQuery.isError ? (
          <Alert color="red" title="Failed to load assignments">
            {(assignmentsQuery.error as Error).message}
          </Alert>
        ) : null}

        {assignmentsQuery.isLoading || shiftRolesQuery.isLoading ? (
          <Loader />
        ) : (
          <Stack gap="sm">
            {assignments.map((assignment) => (
              <Card key={assignment.userId} withBorder shadow="xs">
                <Stack gap="xs">
                  <Text fw={600}>{formatUserName(assignment)}</Text>
                  <MultiSelect
                    data={roleOptions}
                    placeholder={roleOptions.length ? "Select shift roles" : "Create roles first"}
                    value={assignment.roleIds.map((roleId) => roleId.toString())}
                    onChange={(values) => handleChange(assignment, values)}
                    disabled={roleOptions.length === 0 || updateMutation.isPending || !moduleAccess.canUpdate}
                    nothingFoundMessage="No roles"
                    searchable
                    comboboxProps={{ withinPortal: true }}
                  />
                </Stack>
              </Card>
            ))}
            {!assignments.length ? (
              <Text size="sm" c="dimmed">
                No active users found.
              </Text>
            ) : null}
          </Stack>
        )}
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsUserShiftRoles;
