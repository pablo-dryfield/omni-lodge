import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconStar,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import axiosInstance from "../../utils/axiosInstance";
type Staff = {
  userId: number;
  name: string;
  assigned: number;
  manual: number;
  reviewCount: number;
  total: number;
};
type User = {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
};
export default function ReviewOverviewDashboard({ canManage = false }: { canManage?: boolean }) {
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const [summary, setSummary] = useState<{
    staff: Staff[];
    reviewCount: number;
    deletedCount: number;
    unassignedCount: number;
  }>({ staff: [], reviewCount: 0, deletedCount: 0, unassignedCount: 0 });
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({
    userId: "",
    platform: "manual",
    credit: 1,
    notes: "",
  });
  const load = async () => {
    const start = dayjs(`${month}-01`),
      end = start.endOf("month");
    const [s, a] = await Promise.all([
      axiosInstance.get("/reviews/archive/summary", {
        params: {
          start: start.format("YYYY-MM-DD"),
          end: end.format("YYYY-MM-DD"),
        },
      }),
      axiosInstance.get("/reviews/archive", { params: { deleted: "all" } }),
    ]);
    setSummary(s.data);
    setUsers(a.data.users);
  };
  useEffect(() => {
    void load();
  }, [month]);
  const add = async () => {
    await axiosInstance.post("/reviews/archive/manual-credits", {
      ...form,
      userId: Number(form.userId),
      date: `${month}-01`,
    });
    setForm({ ...form, credit: 1, notes: "" });
    await load();
  };
  const cards = [
    ["Archived this month", summary.reviewCount, IconStar, "blue"],
    ["Assigned staff", summary.staff.length, IconUsers, "teal"],
    ["Needs assignment", summary.unassignedCount, IconAlertTriangle, "orange"],
    ["Deleted reviews", summary.deletedCount, IconTrash, "red"],
  ] as const;
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Review performance</Title>
          <Text c="dimmed">
            Credits are calculated directly from archived review assignments.
          </Text>
        </div>
        <TextInput
          type="month"
          value={month}
          onChange={(e) => setMonth(e.currentTarget.value)}
        />
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        {cards.map(([label, value, Icon, color]) => (
          <Paper key={label} p="lg" withBorder radius="lg">
            <Group justify="space-between">
              <Text c="dimmed" size="sm">
                {label}
              </Text>
              <Icon size={20} />
            </Group>
            <Text fz={32} fw={800} c={color}>
              {value}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
      <Paper p="lg" withBorder radius="lg">
        <Title order={4} mb="md">
          Staff credit ledger
        </Title>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Person</Table.Th>
              <Table.Th>Reviews</Table.Th>
              <Table.Th>Assignment credit</Table.Th>
              <Table.Th>Manual additions</Table.Th>
              <Table.Th>Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {summary.staff.map((s) => (
              <Table.Tr key={s.userId}>
                <Table.Td fw={600}>{s.name}</Table.Td>
                <Table.Td>{s.reviewCount}</Table.Td>
                <Table.Td>{s.assigned.toFixed(3)}</Table.Td>
                <Table.Td>{s.manual.toFixed(3)}</Table.Td>
                <Table.Td>
                  <Badge size="lg">{s.total.toFixed(3)}</Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      {canManage && <Paper p="lg" withBorder radius="lg">
        <Title order={4}>Manual counter addition</Title>
        <Text size="sm" c="dimmed" mb="md">
          Only assigned users appear automatically. Use this for an additional
          person or a justified manual adjustment.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            searchable
            label="User"
            data={users.map((u) => ({
              value: String(u.id),
              label: `${u.firstName} ${u.lastName}`.trim() || u.username,
            }))}
            value={form.userId}
            onChange={(v) => setForm({ ...form, userId: v ?? "" })}
          />
          <Select
            label="Platform"
            data={["google", "tripadvisor", "airbnb", "getyourguide", "manual"]}
            value={form.platform}
            onChange={(v) => setForm({ ...form, platform: v ?? "manual" })}
          />
          <NumberInput
            label="Credit"
            decimalScale={3}
            min={0.001}
            value={form.credit}
            onChange={(v) => setForm({ ...form, credit: Number(v) })}
          />
        </SimpleGrid>
        <Textarea
          mt="sm"
          label="Reason"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })}
        />
        <Button mt="md" onClick={add} disabled={!form.userId}>
          Add credit
        </Button>
      </Paper>}
    </Stack>
  );
}
