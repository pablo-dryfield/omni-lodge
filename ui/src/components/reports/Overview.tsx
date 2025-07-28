import { useEffect } from "react";
import {
  Box,
  Group,
  Text,
  Paper,
  Button,
} from "@mantine/core";
import { ArrowUpRight } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { navigateToPage } from "../../actions/navigationActions";
import { GenericPageProps } from "../../types/general/GenericPageProps";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  LabelList,
  TooltipProps,
} from "recharts";
import InfoCards from "../../components/reports/InfoCards"; // Adjust import path if needed
import OverviewGraphics from "../../components/reports/OverviewGraphics";

// Dummy data
const bookingsCreated = 40;
const bookingsLast7 = 39;
const bookingsLast7ASN = 1;
const revenueCollected = 13775.50;
const revenueLast7 = 13775.50;
const bookingTotal = 218075.5;
const bookingChange = 21.71;
const barData = [
  { month: "Jan", y2024: 20600, y2025: 18000 },
  { month: "Feb", y2024: 20800, y2025: 26300 },
  { month: "Mar", y2024: 47000, y2025: 58200 },
  { month: "Apr", y2024: 30500, y2025: 54500 },
  { month: "May", y2024: 62300, y2025: 54200, tooltip: { bookings: 181, pax: 662 } },
  { month: "Jun", y2024: 52000, y2025: 5200 },
  { month: "Jul", y2024: 58600, y2025: 600 },
  { month: "Aug", y2024: 57400, y2025: 1000 },
  { month: "Sep", y2024: 61900, y2025: 0 },
  { month: "Oct", y2024: 62000, y2025: 0 },
  { month: "Nov", y2024: 48400, y2025: 0 },
  { month: "Dec", y2024: 70000, y2025: 0 },
];

// --- Typescript fixes for the custom tooltip:
const CustomTooltip: React.FC<TooltipProps<any, string>> = ({
  active,
  payload,
  label,
}) => {
  if (active && payload && payload.length > 0) {
    const entry2024 = payload.find((p) => p.dataKey === "y2024");
    const entry2025 = payload.find((p) => p.dataKey === "y2025");
    let details = null;
    if (label === "May") {
      details = (
        <Box>
          <Text fw={700} fz={16}>
            PLN {entry2024 ? entry2024.value.toLocaleString() : ""}
          </Text>
          <Text fz={14}>Bookings: 181</Text>
          <Text fz={14}>Pax: 662</Text>
        </Box>
      );
    } else {
      details = (
        <Box>
          {entry2024 && (
            <Text fw={700} fz={16}>
              PLN {entry2024.value.toLocaleString()}
            </Text>
          )}
          {entry2025 && entry2025.value > 0 && (
            <Text fw={700} fz={16} c="#1565c0">
              PLN {entry2025.value.toLocaleString()}
            </Text>
          )}
        </Box>
      );
    }
    return (
      <Paper
        withBorder
        shadow="md"
        style={{
          padding: 12,
          minWidth: 125,
          background: "#23292f",
          color: "#fff",
          borderRadius: 8,
        }}
      >
        {details}
      </Paper>
    );
  }
  return null;
};

const Overview = () => {
  const dispatch = useAppDispatch();

  return (
    <Box py={22} px={8} bg="#fafbfc" style={{ minHeight: "100vh", marginRight: "30px" }}>
      {/* Top Info Cards */}
      <InfoCards
        bookingsCreated={bookingsCreated}
        bookingsLast7={bookingsLast7}
        bookingsLast7ASN={bookingsLast7ASN}
        revenueCollected={revenueCollected}
        revenueLast7={revenueLast7}
      />

      {/* Overview graphics card */}
      <OverviewGraphics
        bookingTotal={bookingTotal}
        bookingChange={bookingChange}
        barData={barData}
        lastRefreshed="11:04 AM"
      />

      {/* Bottom Info Cards (cloned) */}
      <Box mt={28}>
        <InfoCards
          bookingsCreated={bookingsCreated}
          bookingsLast7={bookingsLast7}
          bookingsLast7ASN={bookingsLast7ASN}
          revenueCollected={revenueCollected}
          revenueLast7={revenueLast7}
        />
      </Box>
    </Box>
  );
};

export default Overview;
