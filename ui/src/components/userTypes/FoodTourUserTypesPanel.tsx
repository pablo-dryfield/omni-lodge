import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Modal, Paper, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchUserTypes } from "../../actions/userTypeActions";
import { createFoodTourUserType, updateFoodTourUserType } from "../../api/userTypes";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import type { UserType } from "../../types/userTypes/UserType";

const errorMessage = (error: unknown): string => {
  const data = (error as { response?: { data?: Array<{ message?: string }> } })?.response?.data;
  return data?.[0]?.message ?? (error instanceof Error ? error.message : "Unable to create the user type.");
};

export default function FoodTourUserTypesPanel() {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector(state => state.userTypes)[0];
  const access = useModuleAccess("user-directory");
  const roles = data[0]?.data ?? [];
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<Partial<UserType> | null>(null);
  const [name, setName] = useState("Food Tour ");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => { dispatch(fetchUserTypes()); }, [dispatch]);
  const close = () => {
    if (saving) return;
    setOpened(false); setEditing(null); setName("Food Tour "); setDescription(""); setSource(null); setSaveError(null);
  };
  const edit = (role: Partial<UserType>) => {
    setEditing(role); setName(role.name ?? ""); setDescription(role.description ?? ""); setSource(null); setSaveError(null); setSuccess(null); setOpened(true);
  };
  const save = async () => {
    if (!editing && !source) { setSaveError("Select a permission template."); return; }
    setSaving(true); setSaveError(null); setSuccess(null);
    try {
      const saved = editing?.id
        ? await updateFoodTourUserType(editing.id, { name: name.trim(), description })
        : await createFoodTourUserType({ name: name.trim(), description, sourceUserTypeId: Number(source) });
      setSuccess(editing ? `${saved.name} updated. Users, permissions and product scope are unchanged.` : `${saved.name} created. You can now select it when adding a user.`);
      setOpened(false); setEditing(null); setName("Food Tour "); setDescription(""); setSource(null);
      await dispatch(fetchUserTypes());
    } catch (err) { setSaveError(errorMessage(err)); }
    finally { setSaving(false); }
  };
  return <Stack gap="md">
    {error && <Alert color="red">{error}</Alert>}
    {success && <Alert color="teal">{success}</Alert>}
    <Group justify="space-between">
      <Text fw={600}>Food Tour user types</Text>
      <Button disabled={!access.ready || !access.canCreate || loading} onClick={() => { setEditing(null); setSuccess(null); setOpened(true); }}>Create user type</Button>
    </Group>
    {roles.map(role => <Paper withBorder p="md" key={role.id}>
      <Group justify="space-between"><div><Text fw={600}>{role.name}</Text><Text size="sm" c="dimmed">{role.slug}</Text>{role.description && <Text size="sm">{role.description}</Text>}</div><Group><Badge>Food Tour only</Badge><Button variant="light" aria-label={`Edit ${role.name}`} disabled={!access.ready || !access.canUpdate || loading} onClick={() => edit(role)}>Edit</Button></Group></Group>
    </Paper>)}
    <Modal opened={opened} onClose={close} title={editing ? "Edit Food Tour user type" : "Create Food Tour user type"} centered closeOnClickOutside={!saving} closeOnEscape={!saving}>
      <Stack>
        <TextInput label="Name" description="The Food Tour prefix is added if needed." value={name} onChange={event => setName(event.currentTarget.value)} maxLength={100} required />
        <TextInput label="Product type" value="Food Tour (restricted)" readOnly />
        {editing ? <Text size="sm" c="dimmed">Only the name and description change. The internal role identifier, permissions, assigned users and product scope stay unchanged.</Text> : <Select comboboxProps={{ withinPortal: false }} label="Permission template" placeholder="Choose an existing Food Tour role" data={roles.filter(role => typeof role.id === "number").map(role => ({ value: String(role.id), label: role.name ?? role.slug ?? "Food Tour role" }))} value={source} onChange={setSource} required />}
        <Textarea label="Description" value={description} onChange={event => setDescription(event.currentTarget.value)} maxLength={255} />
        {saveError && <Alert color="red">{saveError}</Alert>}
        <Group justify="flex-end"><Button variant="default" onClick={close} disabled={saving}>Cancel</Button><Button onClick={save} loading={saving} disabled={(!editing && !source) || !name.trim() || name.trim().toLowerCase() === "food tour"}>{editing ? "Save changes" : "Create"}</Button></Group>
      </Stack>
    </Modal>
  </Stack>;
}
