
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconPlus, IconRefresh, IconTrash, IconPencil, IconClipboardList, IconUsersGroup } from '@tabler/icons-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  fetchCompensationComponents,
  createCompensationComponent,
  updateCompensationComponent,
  deleteCompensationComponent,
  createCompensationComponentAssignment,
  updateCompensationComponentAssignment,
  deleteCompensationComponentAssignment,
} from '../../actions/compensationComponentActions';
import type {
  CompensationComponent,
  CompensationComponentAssignment,
} from '../../types/compensation/CompensationComponent';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import { useShiftRoles } from '../../api/shiftRoles';
import type { ServerResponse } from '../../types/general/ServerResponse';

const CATEGORY_OPTIONS = [
  { value: 'base', label: 'Base' },
  { value: 'commission', label: 'Commission' },
  { value: 'incentive', label: 'Incentive' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'review', label: 'Review' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'deduction', label: 'Deduction' },
];

const CALCULATION_METHOD_OPTIONS = [
  { value: 'flat', label: 'Flat' },
  { value: 'per_unit', label: 'Per Unit' },
  { value: 'tiered', label: 'Tiered' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'task_score', label: 'Task Score' },
  { value: 'hybrid', label: 'Hybrid' },
];

const TARGET_SCOPE_OPTIONS = [
  { value: 'global', label: 'Global' },
  { value: 'shift_role', label: 'Shift Role' },
  { value: 'user_type', label: 'User Type' },
  { value: 'user', label: 'Specific User' },
  { value: 'staff_type', label: 'Staff Type' },
];

const STAFF_TYPE_OPTIONS = [
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'long_term', label: 'Long Term' },
  { value: 'assistant_manager', label: 'Assistant Manager' },
  { value: 'manager', label: 'Manager' },
  { value: 'guide', label: 'Guide' },
];

const defaultComponentFormState = {
  name: '',
  slug: '',
  category: 'base',
  calculationMethod: 'flat',
  description: '',
  configText: '{}',
  currencyCode: 'PLN',
  isActive: true,
};

type ComponentFormState = typeof defaultComponentFormState;

type AssignmentFormState = {
  targetScope: string;
  shiftRoleId: string | null;
  userId: string;
  userTypeId: string;
  staffType: string | null;
  effectiveStart: string;
  effectiveEnd: string;
  baseAmount: number;
  unitAmount: number;
  unitLabel: string;
  currencyCode: string;
  taskListText: string;
  configText: string;
  isActive: boolean;
};

const defaultAssignmentFormState: AssignmentFormState = {
  targetScope: 'global',
  shiftRoleId: null,
  userId: '',
  userTypeId: '',
  staffType: null,
  effectiveStart: '',
  effectiveEnd: '',
  baseAmount: 0,
  unitAmount: 0,
  unitLabel: '',
  currencyCode: 'PLN',
  taskListText: '[]',
  configText: '{}',
  isActive: true,
};

const CompensationComponentList = () => {
  const dispatch = useAppDispatch();
  const moduleAccess = useModuleAccess('compensation-component-management');
  const canEdit = moduleAccess.canCreate || moduleAccess.canUpdate;
  const componentState = useAppSelector((state) => state.compensationComponents)[0];
  const components = useMemo<CompensationComponent[]>(() => {
    const payload = (componentState.data as ServerResponse<CompensationComponent> | undefined) ?? [];
    const records = payload[0]?.data ?? [];
    return [...records] as CompensationComponent[];
  }, [componentState.data]);

  const [componentFormOpen, setComponentFormOpen] = useState(false);
  const [componentFormState, setComponentFormState] = useState<ComponentFormState>(defaultComponentFormState);
  const [componentFormError, setComponentFormError] = useState<string | null>(null);
  const [componentSubmitting, setComponentSubmitting] = useState(false);
  const [editingComponent, setEditingComponent] = useState<CompensationComponent | null>(null);

  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [assignmentTargetComponent, setAssignmentTargetComponent] = useState<CompensationComponent | null>(null);
  const [assignmentFormState, setAssignmentFormState] = useState<AssignmentFormState>(defaultAssignmentFormState);
  const [assignmentFormError, setAssignmentFormError] = useState<string | null>(null);
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<CompensationComponentAssignment | null>(null);

  const shiftRolesQuery = useShiftRoles();
  const shiftRoleOptions = useMemo(
    () =>
      ((shiftRolesQuery.data?.[0]?.data ?? []) as Array<{ id: number; name?: string }>).map((role) => ({
        value: String(role.id),
        label: role.name ?? `Role #${role.id}`,
      })),
    [shiftRolesQuery.data],
  );

  useEffect(() => {
    dispatch(fetchCompensationComponents());
  }, [dispatch]);

  const handleRefresh = useCallback(async () => {
    await dispatch(fetchCompensationComponents());
  }, [dispatch]);

  const openCreateForm = useCallback(() => {
    setEditingComponent(null);
    setComponentFormState(defaultComponentFormState);
    setComponentFormError(null);
    setComponentFormOpen(true);
  }, []);

  const openEditForm = useCallback((component: CompensationComponent) => {
    setEditingComponent(component);
    setComponentFormState({
      name: component.name,
      slug: component.slug,
      category: component.category,
      calculationMethod: component.calculationMethod,
      description: component.description ?? '',
      configText: JSON.stringify(component.config ?? {}, null, 2),
      currencyCode: component.currencyCode ?? 'PLN',
      isActive: component.isActive ?? true,
    });
    setComponentFormError(null);
    setComponentFormOpen(true);
  }, []);

  const closeComponentForm = useCallback(() => {
    if (componentSubmitting) return;
    setComponentFormOpen(false);
    setEditingComponent(null);
    setComponentFormState(defaultComponentFormState);
    setComponentFormError(null);
  }, [componentSubmitting]);

  const parseJsonField = (value: string, fallback: Record<string, unknown> | Array<unknown>) => {
    if (!value.trim()) {
      return fallback;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error('Invalid JSON format');
    }
  };

  const handleComponentSubmit = useCallback(async () => {
    if (!componentFormState.name.trim()) {
      setComponentFormError('Name is required');
      return;
    }
    setComponentSubmitting(true);
    setComponentFormError(null);
    try {
      const config = parseJsonField(componentFormState.configText, {}) as Record<string, unknown>;
      const payload = {
        name: componentFormState.name.trim(),
        slug: componentFormState.slug.trim() || undefined,
        category: componentFormState.category as CompensationComponent['category'],
        calculationMethod: componentFormState.calculationMethod as CompensationComponent['calculationMethod'],
        description: componentFormState.description.trim() || null,
        config,
        currencyCode: componentFormState.currencyCode.trim().toUpperCase() || 'PLN',
        isActive: componentFormState.isActive,
      };
      if (editingComponent) {
        await dispatch(updateCompensationComponent({ componentId: editingComponent.id, payload })).unwrap();
      } else {
        await dispatch(createCompensationComponent(payload)).unwrap();
      }
      await dispatch(fetchCompensationComponents());
      closeComponentForm();
    } catch (error) {
      setComponentFormError(error instanceof Error ? error.message : 'Failed to save component');
    } finally {
      setComponentSubmitting(false);
    }
  }, [componentFormState, dispatch, editingComponent, closeComponentForm]);

  const handleDeleteComponent = useCallback(
    async (componentId: number) => {
      if (!window.confirm('Delete this compensation component?')) {
        return;
      }
      try {
        await dispatch(deleteCompensationComponent(componentId)).unwrap();
        await dispatch(fetchCompensationComponents());
      } catch (error) {
        console.error('Failed to delete component', error);
      }
    },
    [dispatch],
  );

  const openAssignmentModal = useCallback((component: CompensationComponent) => {
    setAssignmentTargetComponent(component);
    setAssignmentModalOpen(true);
    setAssignmentFormState(defaultAssignmentFormState);
    setEditingAssignment(null);
    setAssignmentFormError(null);
  }, []);

  const closeAssignmentModal = useCallback(() => {
    if (assignmentSubmitting) return;
    setAssignmentModalOpen(false);
    setAssignmentTargetComponent(null);
    setEditingAssignment(null);
    setAssignmentFormState(defaultAssignmentFormState);
    setAssignmentFormError(null);
  }, [assignmentSubmitting]);

  const populateAssignmentForm = useCallback((assignment: CompensationComponentAssignment) => {
    setAssignmentFormState({
      targetScope: assignment.targetScope,
      shiftRoleId: assignment.shiftRoleId ? String(assignment.shiftRoleId) : null,
      userId: assignment.userId ? String(assignment.userId) : '',
      userTypeId: assignment.userTypeId ? String(assignment.userTypeId) : '',
      staffType: assignment.staffType,
      effectiveStart: assignment.effectiveStart ?? '',
      effectiveEnd: assignment.effectiveEnd ?? '',
      baseAmount: assignment.baseAmount ?? 0,
      unitAmount: assignment.unitAmount ?? 0,
      unitLabel: assignment.unitLabel ?? '',
      currencyCode: assignment.currencyCode ?? 'PLN',
      taskListText: JSON.stringify(assignment.taskList ?? [], null, 2),
      configText: JSON.stringify(assignment.config ?? {}, null, 2),
      isActive: assignment.isActive ?? true,
    });
    setEditingAssignment(assignment);
    setAssignmentFormError(null);
  }, []);

  const handleAssignmentEdit = useCallback(
    (assignment: CompensationComponentAssignment) => {
      populateAssignmentForm(assignment);
    },
    [populateAssignmentForm],
  );

  const handleAssignmentDelete = useCallback(
    async (assignment: CompensationComponentAssignment) => {
      if (!assignmentTargetComponent) {
        return;
      }
      if (!window.confirm('Delete this assignment?')) {
        return;
      }
      try {
        await dispatch(
          deleteCompensationComponentAssignment({ componentId: assignmentTargetComponent.id, assignmentId: assignment.id }),
        ).unwrap();
        await dispatch(fetchCompensationComponents());
      } catch (error) {
        console.error('Failed to delete assignment', error);
      }
    },
    [assignmentTargetComponent, dispatch],
  );

  const handleAssignmentSubmit = useCallback(async () => {
    if (!assignmentTargetComponent) {
      return;
    }
    setAssignmentSubmitting(true);
    setAssignmentFormError(null);
    try {
      const config = parseJsonField(assignmentFormState.configText, {}) as Record<string, unknown>;
      const taskList = parseJsonField(assignmentFormState.taskListText, []) as Array<Record<string, unknown>>;
      const payload = {
        targetScope: assignmentFormState.targetScope as CompensationComponentAssignment['targetScope'],
        shiftRoleId: assignmentFormState.shiftRoleId ? Number(assignmentFormState.shiftRoleId) : undefined,
        userId: assignmentFormState.userId ? Number(assignmentFormState.userId) : undefined,
        userTypeId: assignmentFormState.userTypeId ? Number(assignmentFormState.userTypeId) : undefined,
        staffType: assignmentFormState.staffType || undefined,
        effectiveStart: assignmentFormState.effectiveStart || null,
        effectiveEnd: assignmentFormState.effectiveEnd || null,
        baseAmount: assignmentFormState.baseAmount,
        unitAmount: assignmentFormState.unitAmount,
        unitLabel: assignmentFormState.unitLabel || null,
        currencyCode: assignmentFormState.currencyCode.trim().toUpperCase() || 'PLN',
        taskList,
        config,
        isActive: assignmentFormState.isActive,
      };

      if (payload.targetScope === 'shift_role') {
        payload.userId = undefined;
        payload.userTypeId = undefined;
        payload.staffType = undefined;
      } else if (payload.targetScope === 'user') {
        payload.shiftRoleId = undefined;
        payload.userTypeId = undefined;
        payload.staffType = undefined;
      } else if (payload.targetScope === 'user_type') {
        payload.shiftRoleId = undefined;
        payload.userId = undefined;
        payload.staffType = undefined;
      } else if (payload.targetScope === 'staff_type') {
        payload.shiftRoleId = undefined;
        payload.userId = undefined;
        payload.userTypeId = undefined;
      } else {
        payload.shiftRoleId = undefined;
        payload.userId = undefined;
        payload.userTypeId = undefined;
        payload.staffType = undefined;
      }

      if (editingAssignment) {
        await dispatch(
          updateCompensationComponentAssignment({
            componentId: assignmentTargetComponent.id,
            assignmentId: editingAssignment.id,
            payload,
          }),
        ).unwrap();
      } else {
        await dispatch(
          createCompensationComponentAssignment({
            componentId: assignmentTargetComponent.id,
            payload,
          }),
        ).unwrap();
      }
      await dispatch(fetchCompensationComponents());
      setAssignmentFormState(defaultAssignmentFormState);
      setEditingAssignment(null);
    } catch (error) {
      setAssignmentFormError(error instanceof Error ? error.message : 'Failed to save assignment');
    } finally {
      setAssignmentSubmitting(false);
    }
  }, [assignmentFormState, assignmentTargetComponent, dispatch, editingAssignment]);

  const renderAssignmentTargetFields = () => {
    const scope = assignmentFormState.targetScope;
    if (scope === 'shift_role') {
      return (
        <Select
          label="Shift Role"
          placeholder="Select shift role"
          data={shiftRoleOptions}
          value={assignmentFormState.shiftRoleId}
          onChange={(value) => setAssignmentFormState((prev) => ({ ...prev, shiftRoleId: value }))}
        />
      );
    }
    if (scope === 'user') {
      return (
        <NumberInput
          label="User ID"
          placeholder="Enter user id"
          value={assignmentFormState.userId ? Number(assignmentFormState.userId) : undefined}
          onChange={(value) =>
            setAssignmentFormState((prev) => ({ ...prev, userId: typeof value === 'number' ? String(value) : '' }))
          }
          min={1}
        />
      );
    }
    if (scope === 'user_type') {
      return (
        <NumberInput
          label="User Type ID"
          placeholder="Enter user type id"
          value={assignmentFormState.userTypeId ? Number(assignmentFormState.userTypeId) : undefined}
          onChange={(value) =>
            setAssignmentFormState((prev) => ({ ...prev, userTypeId: typeof value === 'number' ? String(value) : '' }))
          }
          min={1}
        />
      );
    }
    if (scope === 'staff_type') {
      return (
        <Select
          label="Staff Type"
          placeholder="Select staff type"
          data={STAFF_TYPE_OPTIONS}
          value={assignmentFormState.staffType}
          onChange={(value) => setAssignmentFormState((prev) => ({ ...prev, staffType: value }))}
        />
      );
    }
    return null;
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <div>
          <Text size="lg" fw={600}>
            Compensation Components
          </Text>
          <Text size="sm" c="dimmed">
            Define how base pay, commissions, incentives, and bonuses are calculated and who they apply to.
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Refresh data">
            <ActionIcon variant="light" onClick={handleRefresh} disabled={componentState.loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          {canEdit && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreateForm}>
              Add Component
            </Button>
          )}
        </Group>
      </Group>

      {componentState.error && (
        <Alert color="red" title="Failed to load">
          {componentState.error}
        </Alert>
      )}

      {components.length === 0 ? (
        <Card withBorder radius="md" p="xl">
          <Stack gap="xs" align="center">
            <Text size="sm" c="dimmed">
              No compensation components configured yet.
            </Text>
            {canEdit && (
              <Button leftSection={<IconPlus size={16} />} onClick={openCreateForm}>
                Create Component
              </Button>
            )}
          </Stack>
        </Card>
      ) : (
        <Stack gap="sm">
          {components.map((component) => (
            <Card key={component.id} withBorder radius="md" padding="md">
              <Stack gap="xs">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4}>
                    <Group gap="xs">
                      <Text fw={600}>{component.name}</Text>
                      <Badge color="blue" variant="light">
                        {component.category}
                      </Badge>
                      <Badge color="violet" variant="light">
                        {component.calculationMethod}
                      </Badge>
                      <Badge color={component.isActive ? 'teal' : 'gray'}>
                        {component.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed">
                      Slug: {component.slug}
                    </Text>
                    <Group gap="xs">
                      <Badge variant="outline" color="gray">
                        Currency: {component.currencyCode}
                      </Badge>
                      <Badge variant="outline" color="grape">
                        Assignments: {component.assignments.length}
                      </Badge>
                    </Group>
                    {component.description && (
                      <Text size="sm" mt={4}>
                        {component.description}
                      </Text>
                    )}
                  </Stack>
                  <Group gap="xs">
                    <Tooltip label="Assignments">
                      <ActionIcon variant="light" onClick={() => openAssignmentModal(component)} aria-label="Manage assignments">
                        <IconClipboardList size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {canEdit && (
                      <>
                        <Tooltip label="Edit component">
                          <ActionIcon variant="light" onClick={() => openEditForm(component)} aria-label="Edit component">
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete component">
                          <ActionIcon
                            color="red"
                            variant="light"
                            onClick={() => handleDeleteComponent(component.id)}
                            aria-label="Delete component"
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </>
                    )}
                  </Group>
                </Group>
                {component.config && Object.keys(component.config).length > 0 && (
                  <Card withBorder padding="sm" radius="md">
                    <Text size="xs" fw={600} mb={4}>
                      Config
                    </Text>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(component.config, null, 2)}
                    </Text>
                  </Card>
                )}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}

      {/* Component form modal */}
      <Modal
        opened={componentFormOpen}
        onClose={closeComponentForm}
        title={editingComponent ? 'Edit Compensation Component' : 'New Compensation Component'}
        centered
        radius="md"
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            required
            value={componentFormState.name}
            onChange={(event) => setComponentFormState((prev) => ({ ...prev, name: event.currentTarget.value }))}
          />
          <TextInput
            label="Slug"
            description="Will be generated from the name if left blank"
            value={componentFormState.slug}
            onChange={(event) => setComponentFormState((prev) => ({ ...prev, slug: event.currentTarget.value }))}
          />
          <Group grow>
            <Select
              label="Category"
              data={CATEGORY_OPTIONS}
              value={componentFormState.category}
              onChange={(value) => setComponentFormState((prev) => ({ ...prev, category: value ?? prev.category }))}
            />
            <Select
              label="Calculation Method"
              data={CALCULATION_METHOD_OPTIONS}
              value={componentFormState.calculationMethod}
              onChange={(value) =>
                setComponentFormState((prev) => ({ ...prev, calculationMethod: value ?? prev.calculationMethod }))
              }
            />
          </Group>
          <TextInput
            label="Currency Code"
            value={componentFormState.currencyCode}
            onChange={(event) => setComponentFormState((prev) => ({ ...prev, currencyCode: event.currentTarget.value }))}
          />
          <Textarea
            label="Description"
            minRows={3}
            value={componentFormState.description}
            onChange={(event) => setComponentFormState((prev) => ({ ...prev, description: event.currentTarget.value }))}
          />
          <Textarea
            label="Config (JSON)"
            minRows={4}
            description="Provide any additional config needed for calculations."
            value={componentFormState.configText}
            onChange={(event) => setComponentFormState((prev) => ({ ...prev, configText: event.currentTarget.value }))}
          />
          <Switch
            label="Component is active"
            checked={componentFormState.isActive}
            onChange={(event) => setComponentFormState((prev) => ({ ...prev, isActive: event.currentTarget.checked }))}
          />
          {componentFormError && (
            <Alert color="red" title="Unable to save">
              {componentFormError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeComponentForm} disabled={componentSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleComponentSubmit} loading={componentSubmitting}>
              {editingComponent ? 'Save Changes' : 'Create Component'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Assignment modal */}
      <Modal
        opened={assignmentModalOpen}
        onClose={closeAssignmentModal}
        title={
          <Group gap="xs">
            <IconUsersGroup size={16} />
            <Text fw={600}>Assignments{assignmentTargetComponent ? ` � ${assignmentTargetComponent.name}` : ''}</Text>
          </Group>
        }
        centered
        radius="md"
        size="xl"
      >
        {assignmentTargetComponent ? (
          <Stack gap="md">
            <Stack gap="xs" mah={240} style={{ overflowY: 'auto' }}>
              {assignmentTargetComponent.assignments.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No assignments yet.
                </Text>
              ) : (
                assignmentTargetComponent.assignments.map((assignment) => (
                  <Card key={assignment.id} withBorder radius="md" padding="sm">
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={2}>
                        <Group gap="xs">
                          <Badge color="blue" variant="light">
                            {assignment.targetScope}
                          </Badge>
                          {assignment.staffType && (
                            <Badge color="teal" variant="outline">
                              {assignment.staffType}
                            </Badge>
                          )}
                          {assignment.shiftRoleName && (
                            <Badge color="grape" variant="outline">
                              {assignment.shiftRoleName}
                            </Badge>
                          )}
                          {assignment.userName && (
                            <Badge color="indigo" variant="outline">
                              {assignment.userName}
                            </Badge>
                          )}
                          {assignment.userTypeName && (
                            <Badge color="yellow" variant="outline">
                              {assignment.userTypeName}
                            </Badge>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed">
                          Effective: {assignment.effectiveStart ? assignment.effectiveStart : 'immediately'} -{' '}
                          {assignment.effectiveEnd ? assignment.effectiveEnd : 'open'}
                        </Text>
                        <Text size="sm">
                          Base: {assignment.baseAmount.toFixed(2)} {assignment.currencyCode} � Unit:{' '}
                          {assignment.unitAmount.toFixed(4)} {assignment.currencyCode}
                          {assignment.unitLabel ? ` / ${assignment.unitLabel}` : ''}
                        </Text>
                      </Stack>
                      <Group gap="xs">
                        <Tooltip label="Edit assignment">
                          <ActionIcon variant="light" onClick={() => handleAssignmentEdit(assignment)} aria-label="Edit assignment">
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete assignment">
                          <ActionIcon
                            color="red"
                            variant="light"
                            onClick={() => handleAssignmentDelete(assignment)}
                            aria-label="Delete assignment"
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                  </Card>
                ))
              )}
            </Stack>

            <Stack gap="md">
              <Text fw={600}>{editingAssignment ? 'Edit Assignment' : 'Add Assignment'}</Text>
              <Select
                label="Target Scope"
                data={TARGET_SCOPE_OPTIONS}
                value={assignmentFormState.targetScope}
                onChange={(value) =>
                  setAssignmentFormState((prev) => ({
                    ...prev,
                    targetScope: value ?? prev.targetScope,
                    shiftRoleId: null,
                    userId: '',
                    userTypeId: '',
                    staffType: null,
                  }))
                }
              />
              {renderAssignmentTargetFields()}
              <Group grow>
                <TextInput
                  label="Effective Start"
                  type="date"
                  value={assignmentFormState.effectiveStart}
                  onChange={(event) =>
                    setAssignmentFormState((prev) => ({ ...prev, effectiveStart: event.currentTarget.value }))
                  }
                />
                <TextInput
                  label="Effective End"
                  type="date"
                  value={assignmentFormState.effectiveEnd}
                  onChange={(event) => setAssignmentFormState((prev) => ({ ...prev, effectiveEnd: event.currentTarget.value }))}
                />
              </Group>
              <Group grow>
                <NumberInput
                  label="Base Amount"
                  value={assignmentFormState.baseAmount}
                  onChange={(value) =>
                    setAssignmentFormState((prev) => ({
                      ...prev,
                      baseAmount: typeof value === 'number' ? value : prev.baseAmount,
                    }))
                  }
                  precision={2}
                  min={0}
                />
                <NumberInput
                  label="Unit Amount"
                  value={assignmentFormState.unitAmount}
                  onChange={(value) =>
                    setAssignmentFormState((prev) => ({
                      ...prev,
                      unitAmount: typeof value === 'number' ? value : prev.unitAmount,
                    }))
                  }
                  precision={4}
                  min={0}
                />
              </Group>
              <Group grow>
                <TextInput
                  label="Unit Label"
                  placeholder="e.g., attendee, review"
                  value={assignmentFormState.unitLabel}
                  onChange={(event) => setAssignmentFormState((prev) => ({ ...prev, unitLabel: event.currentTarget.value }))}
                />
                <TextInput
                  label="Currency Code"
                  value={assignmentFormState.currencyCode}
                  onChange={(event) =>
                    setAssignmentFormState((prev) => ({ ...prev, currencyCode: event.currentTarget.value }))
                  }
                />
              </Group>
              <Textarea
                label="Task List (JSON)"
                minRows={3}
                value={assignmentFormState.taskListText}
                onChange={(event) => setAssignmentFormState((prev) => ({ ...prev, taskListText: event.currentTarget.value }))}
              />
              <Textarea
                label="Config (JSON)"
                minRows={3}
                value={assignmentFormState.configText}
                onChange={(event) => setAssignmentFormState((prev) => ({ ...prev, configText: event.currentTarget.value }))}
              />
              <Switch
                label="Assignment is active"
                checked={assignmentFormState.isActive}
                onChange={(event) => setAssignmentFormState((prev) => ({ ...prev, isActive: event.currentTarget.checked }))}
              />
              {assignmentFormError && (
                <Alert color="red" title="Unable to save assignment">
                  {assignmentFormError}
                </Alert>
              )}
              <Group justify="flex-end">
                <Button
                  variant="default"
                  onClick={() => {
                    setAssignmentFormState(defaultAssignmentFormState);
                    setEditingAssignment(null);
                  }}
                  disabled={assignmentSubmitting}
                >
                  Reset
                </Button>
                <Button onClick={handleAssignmentSubmit} loading={assignmentSubmitting}>
                  {editingAssignment ? 'Save Assignment' : 'Add Assignment'}
                </Button>
              </Group>
            </Stack>
          </Stack>
        ) : (
          <Text size="sm">Select a component to manage assignments.</Text>
        )}
      </Modal>
    </Stack>
  );
};

export default CompensationComponentList;
