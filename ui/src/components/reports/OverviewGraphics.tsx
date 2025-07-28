import { FC, useRef, useState } from "react";
import {
    Box,
    Group,
    Text,
    Paper,
    Button,
} from "@mantine/core";
import { ArrowUpRight } from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    ResponsiveContainer,
    LabelList,
    CartesianGrid,
} from "recharts";

interface OverviewGraphicsProps {
    bookingTotal: number;
    bookingChange: number;
    barData: any[];
    lastRefreshed?: string;
}

const tooltipBoxStyle: React.CSSProperties = {
    background: "#363D4B", // closer to screenshot dark gray
    color: "#fff",
    borderRadius: 14,
    padding: "13px 18px 11px 18px",
    minWidth: 200,
    width: 235,
    textAlign: "left",
    boxShadow: "0 2px 8px rgba(0,0,0,0.17)",
    fontSize: 15,
    pointerEvents: "none",
    position: "absolute",
    zIndex: 99999,
    lineHeight: 1.18,
    transition: "opacity 0.1s",
};

const percentBadgeStyle: React.CSSProperties = {
    display: "inline-block",
    marginLeft: 10,
    padding: "2.5px 13px 2.5px 13px",
    background: "#d1f7e4",
    color: "#13c06d",
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 15,
    verticalAlign: "middle",
    lineHeight: 1.1,
    letterSpacing: 0.1,
};

const lineGroupStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 1,
    minHeight: 28,
};

const OverviewGraphics: FC<OverviewGraphicsProps> = ({
    bookingTotal,
    bookingChange,
    barData,
    lastRefreshed = "11:04 AM",
}) => {
    const chartRef = useRef<HTMLDivElement>(null);

    // State for tooltip
    const [barTooltip, setBarTooltip] = useState<{
        left: number;
        top: number;
        value: number;
        year: 2024 | 2025;
        month: string;
        bookings?: number;
        pax?: number;
        percent?: number;
        bookingsPercent?: number;
        paxPercent?: number;
    } | null>(null);

    // Calculate bar position relative to the chart container
    const handleBarMouseOver = (data: any, index: number, evt: any, year: 2024 | 2025) => {
        const rect = evt.target.getBoundingClientRect();
        const chartBox = chartRef.current?.getBoundingClientRect();
        if (!chartBox) return;

        const barCenterX = rect.left + rect.width / 2;
        const barTopY = rect.top;
        const left = barCenterX - chartBox.left;
        const top = barTopY - chartBox.top;

        setBarTooltip({
            left: left,
            top: top,
            value: data[`y${year}`],
            year,
            month: data.month,
            bookings: data[`bookings${year}`],
            pax: data[`pax${year}`],
            percent: data.percent2025,
            bookingsPercent: data.bookingsPercent2025,
            paxPercent: data.paxPercent2025,
        });
    };

    const handleBarMouseOut = () => setBarTooltip(null);

    return (
        <Paper
            radius="md"
            withBorder
            shadow="sm"
            mt={30}
            style={{
                background: "#fff",
                borderColor: "#e9ecef",
                width: "100%",
                padding: "15px 15px 15px 15px",
                boxSizing: "border-box",
                position: "relative",
            }}
        >
            {/* Header */}
            <Group justify="space-between" mb={4} align="start" style={{ width: "100%" }}>
                <Text fz={14} lts={-0.2} fw={500} c="#222" style={{ letterSpacing: 0.1 }}>
                    2025 booking total:
                </Text>
                <Text fz={12} lts={-0.5} c="#888">
                    Last refreshed at {lastRefreshed}
                </Text>
            </Group>
            <Group justify="space-between" align="flex-end" style={{ width: "100%" }}>
                <Group align="center" gap={10}>
                    <Text fz={25} lts={-0.5} fw={800}>
                        PLN {bookingTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </Text>
                    <Box
                        px={5}
                        py={3}
                        bg="#dcfce7"
                        lts={-1}
                        style={{
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            color: "#15803d",
                            fontWeight: 700,
                            fontSize: 15,
                            height: 27,
                        }}
                    >
                        <ArrowUpRight size={20} style={{ color: "#28a745", marginRight: 4 }} />
                        <span style={{ color: "#22a063", fontWeight: 600, fontSize: 15 }}>
                            {bookingChange}% vs same time last year
                        </span>
                    </Box>
                </Group>
                <Group gap={8} style={{ marginBottom: 15 }}>
                    <Group gap={4}>
                        <Box w={12} h={12} bg="#ff6600" style={{ borderRadius: 2 }} />
                        <Text lts={-0.3} fz={13} c="#23292f">
                            2024
                        </Text>
                    </Group>
                    <Group gap={4}>
                        <Box w={12} h={12} bg="#1565c0" style={{ borderRadius: 2 }} />
                        <Text lts={-0.3} fz={13} c="#23292f">
                            2025
                        </Text>
                    </Group>
                </Group>
            </Group>
            <Text fz={15} c="#767676" mb={25} mt={2}>
                Based on availability date
            </Text>
            <Box
                ref={chartRef}
                style={{
                    width: "100%",
                    height: 240,
                    marginLeft: "-35px",
                    marginRight: "-35px",
                    position: "relative",
                }}
            >
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={barData}
                        barSize={32}
                        barGap={1}
                    >
                        <XAxis
                            dataKey="month"
                            axisLine={true}
                            tickLine={false}
                            tick={{ fill: "#888", fontSize: 13, fontWeight: 600 }}
                        />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "#888", fontSize: 13 }}
                            tickFormatter={(value) => `${Math.round(Number(value) / 1000)}K`}
                            ticks={[0, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000]}
                            interval={0}
                        />
                        <CartesianGrid strokeOpacity={0.3} stroke="black" strokeDasharray="3 3" vertical={false} />
                        <Bar
                            dataKey="y2024"
                            fill="#ff6600"
                            radius={[7, 7, 0, 0]}
                            onMouseOver={(data, idx, e) => handleBarMouseOver(data, idx, e, 2024)}
                            onMouseOut={handleBarMouseOut}
                        >
                            <LabelList
                                dataKey="y2024"
                                position="top"
                                formatter={(value: number) => `${Math.round(value / 1000)}K`}
                                style={{ fontSize: 13, fontWeight: 600, fill: "#23292f" }}
                            />
                        </Bar>
                        <Bar
                            dataKey="y2025"
                            fill="#1565c0"
                            radius={[7, 7, 0, 0]}
                            onMouseOver={(data, idx, e) => handleBarMouseOver(data, idx, e, 2025)}
                            onMouseOut={handleBarMouseOut}
                        >
                            <LabelList
                                dataKey="y2025"
                                position="top"
                                formatter={(value: number) =>
                                    value > 0 ? `${Math.round(value / 1000)}K` : ""
                                }
                                style={{ fontSize: 13, fontWeight: 600, fill: "#1565c0" }}
                            />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
                {/* Tooltip absolutely positioned above the hovered bar */}
                {barTooltip && (
                    <div style={{
                        ...tooltipBoxStyle,
                        left: barTooltip.left - 120, // perfect centering for 235px width
                        top: barTooltip.top - 111, // now even higher above the bar!
                        opacity: 1,
                    }}>
                        <div style={lineGroupStyle}>
                            <Text fw={700} fz={18} c="#fff" style={{ marginBottom: 0 }}>
                                PLN {barTooltip.value.toLocaleString()}
                            </Text>
                            {barTooltip.year === 2025 && barTooltip.percent !== undefined && (
                                <span style={percentBadgeStyle}>{barTooltip.percent}%</span>
                            )}
                        </div>
                        <div style={lineGroupStyle}>
                            <Text c="#8fa2b7" fw={700} style={{ minWidth: 100 }}>
                                Bookings: <span style={{ color: "#fff", fontWeight: 400 }}>{barTooltip.bookings}</span>
                            </Text>
                            {barTooltip.year === 2025 && barTooltip.bookingsPercent !== undefined && (
                                <span style={percentBadgeStyle}>{barTooltip.bookingsPercent}%</span>
                            )}
                        </div>
                        <div style={lineGroupStyle}>
                            <Text c="#8fa2b7" fw={700} style={{ minWidth: 70 }}>
                                Pax: <span style={{ color: "#fff", fontWeight: 400 }}>{barTooltip.pax}</span>
                            </Text>
                            {barTooltip.year === 2025 && barTooltip.paxPercent !== undefined && (
                                <span style={percentBadgeStyle}>{barTooltip.paxPercent}%</span>
                            )}
                        </div>
                    </div>
                )}
            </Box>
            <Box style={{ textAlign: "center", marginTop: 4 }}>
                <Button
                    variant="subtle"
                    size="sm"
                    color="blue"
                    style={{
                        textDecoration: "underline",
                        background: "transparent",
                        fontWeight: 500,
                        fontSize: 15,
                        margin: 0,
                        padding: 0,
                    }}
                >
                    Show details
                </Button>
            </Box>
        </Paper>
    );
};

export default OverviewGraphics;
