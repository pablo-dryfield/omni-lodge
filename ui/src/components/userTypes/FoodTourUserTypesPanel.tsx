import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Modal, Paper, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchUserTypes } from "../../actions/userTypeActions";
import { createFoodTourUserType } from "../../api/userTypes";
import { useModuleAccess } from "../../hooks/useModuleAccess";

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
  const [name, setName] = useState("Food Tour ");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => { dispatch(fetchUserTypes()); }, [dispatch]);
  const close = () => {
    if (saving) return;
    setOpened(false); setName("Food Tour "); setDescription(""); setSource(null); setSaveError(null);
  };
  const save = async () => {
    if (!source) { setSaveError("Select a permission template."); return; }
    setSaving(true); setSaveError(null); setSuccess(null);
    try {
      const created = await createFoodTourUserType({ name: name.trim(), description, sourceUserTypeId: Number(source) });
      setSuccess(`${created.name} created. You can now select it when adding a user.`);
      setOpened(false); setName("Food Tour "); setDescription(""); setSource(null);
      await dispatch(fetchUserTypes());
    } catch (err) { setSaveError(errorMessage(err)); }
    finally { setSaving(false); }
  };
  return <Stack gap="md">
    <Alert color="blue" title="Food Tour-only user types">
      New roles are always restricted to Food Tour. Choose an existing Food Tour role as the permission template;
      only its product-scoped access is copied. Global permissions and role administration are not copied.
    </Alert>
    {error && <Alert color="red">{error}</Alert>}
    {success && <Alert color="teal">{success}</Alert>}
    <Group justify="space-between">
      <Text fw={600}>Food Tour user types</Text>
      <Button disabled={!access.ready || !access.canCreate || loading} onClick={() => { setSuccess(null); setOpened(true); }}>Create user type</Button>
    </Group>
    {roles.map(role => <Paper withBorder p="md" key={role.id}>
      <Group justify="space-between"><div><Text fw={600}>{role.name}</Text><Text size="sm" c="dimmed">{role.slug}</Text></div><Badge>Food Tour only</Badge></Group>
    </Paper>)}
    <Modal opened={opened} onClose={close} title="Create Food Tour user type" centered closeOnClickOutside={!saving} closeOnEscape={!saving}>
      <Stack>
        <TextInput label="Name" description="The Food Tour prefix is added if needed." value={name} onChange={event => setName(event.currentTarget.value)} maxLength={100} required />
        <TextInput label="Product type" value="Food Tour (restricted)" readOnly />
        <Select comboboxProps={{ withinPortal: false }} label="Permission template" placeholder="Choose an existing Food Tour role" data={roles.filter(role => typeof role.id === "number").map(role => ({ value: String(role.id), label: role.name ?? role.slug ?? "Food Tour role" }))} value={source} onChange={setSource} required />
        <Textarea label="Description" value={description} onChange={event => setDescription(event.currentTarget.value)} maxLength={255} />
        {saveError && <Alert color="red">{saveError}</Alert>}
        <Group justify="flex-end"><Button variant="default" onClick={close} disabled={saving}>Cancel</Button><Button onClick={save} loading={saving} disabled={!source || !name.trim() || name.trim().toLowerCase() === "food tour"}>Create</Button></Group>
      </Stack>
    </Modal>
  </Stack>;
}
