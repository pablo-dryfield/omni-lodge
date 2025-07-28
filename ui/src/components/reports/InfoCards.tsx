import { FC } from "react";
import { Box, Group, Text, Paper, Table } from "@mantine/core";

interface InfoCardsProps {
  bookingsCreated: number;
  bookingsLast7: number;
  bookingsLast7ASN: number;
  revenueCollected: number;
  revenueLast7: number;
}

const InfoCards: FC<InfoCardsProps> = ({
  bookingsCreated,
  bookingsLast7,
  bookingsLast7ASN,
  revenueCollected,
  revenueLast7,
}) => (
  <Group align="start" gap="xl" mb="md" wrap="wrap">
    {/* BOOKINGS CREATED */}
    <Paper
      radius="md"
      withBorder
      shadow="xs"
      p="lg"
      style={{
        minWidth: 340,
        minHeight: 150,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <Box>
        <Group justify="space-between" mb="xl">
          <Text size="xs" c="dimmed" style={{ textTransform: "uppercase", letterSpacing: 1 }}>
            Bookings Created
          </Text>
          <Text size="xs" c="gray" style={{ textTransform: "uppercase", opacity: 0.8 }}>
            Last 7 days
          </Text>
        </Group>
        <Text fw={200} style={{ fontSize: 35, lineHeight: 1.2 }}>
          {bookingsCreated}
        </Text>
        <Table withColumnBorders={false} style={{ fontSize: 13 }}>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td p={0}>
                <b>Online</b>
              </Table.Td>
              <Table.Td p={0} style={{ textAlign: "right" }}>
                {bookingsLast7}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Box>
    </Paper>
    {/* REVENUE COLLECTED */}
    <Paper
      radius="md"
      withBorder
      shadow="xs"
      p="lg"
      style={{
        minWidth: 340,
        minHeight: 150,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <Box>
        <Group justify="space-between" mb="xl">
          <Text size="xs" c="dimmed" style={{ textTransform: "uppercase", letterSpacing: 1 }}>
            Revenue Collected
          </Text>
          <Text size="xs" c="gray" style={{ textTransform: "uppercase", opacity: 0.8 }}>
            Last 7 days
          </Text>
        </Group>
        <Text fw={200} style={{ fontSize: 35, lineHeight: 1.2 }}>
          PLN{revenueCollected.toLocaleString()}
        </Text>
        <Table withColumnBorders={false} style={{ fontSize: 13 }}>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td p={0}>
                <b>Credit card</b>
              </Table.Td>
              <Table.Td p={0} style={{ textAlign: "right" }}>
                PLN{revenueLast7.toLocaleString()}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Box>
    </Paper>
  </Group>
);

export default InfoCards;
