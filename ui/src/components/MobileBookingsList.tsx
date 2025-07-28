import React, { useMemo, useEffect, useState, useRef } from "react";
import { ChevronLeft, ChevronRight, Lock, Phone } from "lucide-react";
import { UnifiedProduct } from "../store/bookingPlatformsTypes";
import { BookingCell } from "../utils/prepareBookingGrid";

// --- STYLE CONSTANTS ---
const ROW_COLORS: Record<string, string> = {
    pub: "#ffe5cc",
    beer: "#e3ffe7",
    brunch: "#fffbe3",
    food: "#fffbe3",
    drawing: "#e3ffe7",
    cocktail: "#e3edff",
    default: "#f1f5fb"
};
const BORDER_BOTTOM_COLORS: Record<string, string> = {
    pub: "#bf6d17",
    beer: "#20643e",
    brunch: "#b89b44",
    food: "#b89b44",
    drawing: "#20643e",
    cocktail: "#276eae",
    default: "#bbb"
};
const ICONS: Record<string, JSX.Element> = {
    pub: <Lock size={15} fill="#5a6672" style={{ marginRight: 4, color: "#5a6672" }} />,
    beer: <Phone size={15} fill="#5a6672" style={{ marginRight: 4, color: "#5a6672" }} />,
    brunch: <Lock size={15} fill="#5a6672" style={{ marginRight: 4, color: "#5a6672" }} />,
    food: <Lock size={15} fill="#5a6672" style={{ marginRight: 4, color: "#5a6672" }} />,
    drawing: <Phone size={15} fill="#5a6672" style={{ marginRight: 4, color: "#5a6672" }} />,
    cocktail: <Lock size={15} fill="#5a6672" style={{ marginRight: 4, color: "#5a6672" }} />,
    default: <Lock size={15} fill="#5a6672" style={{ marginRight: 4, color: "#5a6672" }} />
};

function getRowKey(name: string): string {
    name = name.toLowerCase();
    if (name.includes("pub crawl")) return "pub";
    if (name.includes("beer")) return "beer";
    if (name.includes("brunch")) return "brunch";
    if (name.includes("food")) return "food";
    if (name.includes("drawing")) return "drawing";
    if (name.includes("cocktail")) return "cocktail";
    return "default";
}
function isSameDay(a: string, b: string) {
    return new Date(a).toDateString() === new Date(b).toDateString();
}
function formatTabDate(date: string) {
    const d = new Date(date);
    return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}/${d.getMonth() + 1}`;
}

type Props = {
    products: UnifiedProduct[];
    dateRange: string[];
    grid: { [productId: string]: { [date: string]: BookingCell[] } };
    startDate: string;
    setStartDate: (date: string) => void;
    weekStart: string;
    setWeekStart: (date: string) => void;
    goToToday: () => void;
};

export const MobileBookingsList: React.FC<Props> = ({
    products,
    dateRange,
    grid,
    startDate,
    setStartDate,
    weekStart,
    setWeekStart,
    goToToday
}) => {
    const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const activeIdx = Math.max(dateRange.findIndex((d) => isSameDay(d, startDate)), 0);

    // On mount: If startDate is not today and today exists in dateRange, set it.
    useEffect(() => {
        const todayIdx = dateRange.findIndex((d) => isSameDay(d, todayISO));
        if (
            todayIdx !== -1 &&
            !isSameDay(startDate, todayISO)
        ) {
            setStartDate(dateRange[todayIdx]);
        }
        // eslint-disable-next-line
    }, []); // Only run on mount

    // --- WEEK NAVIGATION LOGIC ---
    // Shifts the week start and also auto-selects the first day of the week
    const shiftWeek = (days: number) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + days);
        const newWeekStart = d.toISOString().slice(0, 10);
        setWeekStart(newWeekStart);
        setStartDate(newWeekStart); // auto-select first day in week
    };

    // Today: Set week to this week and selected date to today
    const handleGoToToday = () => {
        goToToday(); // Parent handles setWeekStart and setStartDate together
    };

    // --- ARROW BUTTON LOGIC FOR DAYS (optional, can remove if week navigation only) ---
    const shiftDay = (dir: number) => {
        let next = activeIdx + dir;
        if (next < 0) next = 0;
        if (next >= dateRange.length) next = dateRange.length - 1;
        setStartDate(dateRange[next]);
    };

    // --- Collect all timeslots for the day, flatten ---
    const daySlots: { product: UnifiedProduct; rowKey: string; cell: BookingCell }[] = [];
    products.forEach((product) => {
        const rowKey = getRowKey(product.name);
        (grid[product.id][dateRange[activeIdx]] || []).forEach((cell) => {
            daySlots.push({ product, rowKey, cell });
        });
    });
    daySlots.sort((a, b) => (a.cell.time < b.cell.time ? -1 : 1));

    const [btnActive, setBtnActive] = useState(false);
    const [holdActive, setHoldActive] = useState(false);
    const holdTimer = useRef<NodeJS.Timeout | null>(null);

    function handleBtnDown() {
        // Start hold after 300ms
        holdTimer.current = setTimeout(() => {
            setBtnActive(true);
            setHoldActive(true);
        }, 300);
    }

    function handleBtnUp() {
        // If hold was active, execute today
        if (holdActive) {
            handleGoToToday();
        }
        setBtnActive(false);
        setHoldActive(false);
        if (holdTimer.current) {
            clearTimeout(holdTimer.current);
            holdTimer.current = null;
        }
    }

    function handleClick(e: React.MouseEvent | React.TouchEvent) {
        // If hold was triggered, ignore click (it will fire after hold)
        if (holdActive) return;
        setBtnActive(true);
        handleGoToToday();
        setTimeout(() => setBtnActive(false), 140);
    }

    return (
        <div
            style={{
                width: "100%",
                //maxWidth: 440,
                margin: "0 auto",
                padding: 0,
                background: "none",
                borderRadius: 0
            }}
        >
            <div
                style={{
                    width: "100%",
                    marginBottom: 2,
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    padding: "15px 19px 0 0",
                }}
            >
                <button
                    aria-label="Previous week"
                    onClick={() => shiftWeek(-7)}
                    style={{
                        background: "none",
                        border: "0.1px solid #d0c7c7",
                        borderRadius: 7,
                        padding: "4px 7px",
                        fontSize: 16,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        height: 55,
                        marginRight: 6
                    }}
                >
                    <ChevronLeft size={18} color="#3b3b3b" style={{ display: "block", margin: 0 }} />
                </button>
                <button
                    aria-label="Today"
                    onClick={handleClick}
                    onMouseDown={handleBtnDown}
                    onMouseUp={handleBtnUp}
                    onMouseLeave={handleBtnUp}
                    onTouchStart={handleBtnDown}
                    onTouchEnd={handleBtnUp}
                    style={{
                        fontSize: 14,
                        background: btnActive ? "#0a6ece" : "none",
                        color: btnActive ? "#fff" : "#222",
                        border: "0.1px solid #d0c7c7",
                        borderRadius: 7,
                        fontWeight: 700,
                        padding: 15,
                        cursor: "pointer",
                        outline: "none",
                        transition: "background .13s, color .13s"
                    }}
                >
                    Today
                </button>
                <button
                    aria-label="Next week"
                    onClick={() => shiftWeek(7)}
                    style={{
                        background: "none",
                        border: "0.1px solid #d0c7c7",
                        borderRadius: 7,
                        padding: "4px 7px",
                        fontSize: 16,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        height: 55,
                        marginLeft: 6
                    }}
                >
                    <ChevronRight size={18} color="#3b3b3b" style={{ display: "block", margin: 0 }} />
                </button>
            </div>
            {/* NAV BAR: Arrow left, Date Tabs, Arrow right (single-day shift optional, remove if not needed) */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 3,
                    margin: "30px 20px 30px 20px",
                    padding: "0 2px",
                    height: 44,
                    position: "relative"
                }}
            >
                <div
                    className="date-tabs-scroll"
                    style={{
                        flex: 1,
                        overflowX: "auto",
                        display: "flex",
                        alignItems: "center",
                        scrollbarWidth: "thin",
                        scrollbarColor: "#bbbbbb #f4f4f4",
                        msOverflowStyle: "none",
                        position: "relative",
                        height: 85,
                    }}
                >
                    {dateRange.map((date, idx) => {
                        // Date logic
                        const isToday = isSameDay(date, todayISO);
                        const isActive = idx === activeIdx;

                        let background = "#ededed";
                        let color = "#444";
                        let fontWeight = isActive ? 900 : 700;
                        let boxShadow = "none";
                        let border = "1.2px solid #eee";
                        if (isToday && isActive) {
                            background = "#fff1ba";
                            color = "#1f2428";
                            fontWeight = 900;
                            border = "1.5px solid #ad963d";
                            boxShadow = "0 0 6px #e2ca6b";
                        } else if (isToday && !isActive) {
                            background = "#fff1ba";
                            color = "#1f2428";
                        } else if (isActive && !isToday) {
                            background = "#0a6ece";
                            color = "#fff";
                            border = "1.5px solid #0a6ece";
                        }

                        return (
                            <button
                                key={date}
                                aria-label={formatTabDate(date)}
                                onClick={() => setStartDate(dateRange[idx])}
                                style={{
                                    background,
                                    color,
                                    border,
                                    fontWeight,
                                    fontSize: 16,
                                    borderRadius: 8,
                                    height: 65,
                                    lineHeight: "32px",
                                    padding: "0 18px",
                                    marginLeft: idx === 0 ? 4 : 8,
                                    marginRight: idx === dateRange.length - 1 ? 4 : 0,
                                    cursor: "pointer",
                                    minWidth: 82,
                                    maxWidth: 120,
                                    flexShrink: 0,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    boxShadow,
                                    transition: "background .11s, border .14s, color .13s, box-shadow .13s"
                                }}
                            >
                                {formatTabDate(date)}
                            </button>
                        );
                    })}
                    <style>{`
              .date-tabs-scroll::-webkit-scrollbar {
                height: 5px;
                background: transparent;
                opacity: 0;
                transition: opacity 0.32s;
              }
              .date-tabs-scroll:hover::-webkit-scrollbar,
              .date-tabs-scroll:active::-webkit-scrollbar,
              .date-tabs-scroll:focus::-webkit-scrollbar {
                opacity: 1;
                background: #f8f8f8;
              }
              .date-tabs-scroll::-webkit-scrollbar-thumb {
                background: #bbbbbb;
                border-radius: 4px;
                transition: background 0.19s;
              }
            `}</style>
                </div>
            </div>

            {/* TIMESLOTS LIST */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 13,
                    width: "100%",
                    padding: "2px 16px 2px 16px"
                }}
            >
                {daySlots.length === 0 && (
                    <div
                        style={{
                            color: "#b0b0b0",
                            textAlign: "center",
                            fontSize: 15,
                            fontWeight: 400,
                            padding: "48px 0"
                        }}
                    >
                        No bookings for this day.
                    </div>
                )}
                {daySlots.map(({ product, rowKey, cell }, idx) => (
                    <TimeslotCard
                        key={cell.time + product.id + idx}
                        rowKey={rowKey}
                        cell={cell}
                        productName={product.name}
                    />
                ))}
            </div>
        </div>
    );
};

// --- Card for mobile timeslot ---
const TimeslotCard = ({
    rowKey,
    cell,
    productName
}: {
    rowKey: string;
    cell: BookingCell;
    productName: string;
}) => {
    const [hovered, setHovered] = useState(false);

    // Double chevron as SVG (to match screenshot)
    const doubleChevron = (
        <svg width="20" height="16" viewBox="0 0 20 16" fill="none" style={{ display: "block" }}>
            <g>
                <path d="M9.7 2.6c-.2-.2-.2-.5 0-.7.2-.2.5-.2.7 0l4.6 4.8c.2.2.2.5 0 .7l-4.6 4.8c-.2.2-.5.2-.7 0-.2-.2-.2-.5 0-.7l4.2-4.5-4.2-4.4zm-5.1 0c-.2-.2-.2-.5 0-.7.2-.2.5-.2.7 0l4.6 4.8c.2.2.2.5 0 .7l-4.6 4.8c-.2.2-.5.2-.7 0-.2-.2-.2-.5 0-.7l4.2-4.5-4.2-4.4z" fill="#b3b3b3" />
            </g>
        </svg>
    );

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: "flex",
                flexDirection: "column",
                background: hovered ? "#bdf9b8" : ROW_COLORS[rowKey],
                borderRadius: 5,
                border: `1.5px solid #ef8625`,
                borderBottom: `3.5px solid ${BORDER_BOTTOM_COLORS[rowKey]}`,
                padding: "7px 11px 7px 11px",
                minHeight: 38,
                lineHeight: 1,
                fontFamily:
                    "Roboto,-apple-system,BlinkMacSystemFont,Segoe UI,Oxygen,Ubuntu,Cantarell,Fira Sans,Droid Sans,Helvetica Neue,sans-serif",
                boxSizing: "border-box",
                boxShadow: hovered
                    ? "0 3px 12px 0 rgba(45,180,74,0.07)"
                    : "0 1px 1px 0 rgba(195,195,195,0.09)",
                transition: "background .11s"
            }}
        >
            {/* Row: Icon, time, product, double arrow */}
            <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                {ICONS[rowKey]}
                <span
                    style={{
                        fontWeight: 700,
                        fontSize: 15.3,
                        color: "#2B3137",
                        marginRight: 6
                    }}
                >
                    {cell.time}
                </span>
                <span
                    style={{
                        fontSize: 13.3,
                        fontWeight: 500,
                        color: "#222",
                        letterSpacing: 0.07,
                        lineHeight: 1.13,
                        marginTop: 1,
                        marginLeft: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        flex: 1
                    }}
                >
                    {productName}
                </span>
                <span style={{ marginLeft: 6, display: "flex", alignItems: "center" }}>
                    {doubleChevron}
                </span>
            </div>
            {/* Booking count under row */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 2, marginTop: 3 }}>
                <span
                    style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        border: "1.5px solid #0f6d09",
                        borderRadius: 3,
                        marginRight: 3,
                        background: "transparent"
                    }}
                />
                <span
                    style={{
                        fontSize: 12.5,
                        color: "#0f6d09",
                        fontWeight: 500,
                        letterSpacing: "0.13px"
                    }}
                >
                    {cell.bookingCount}
                </span>
            </div>
        </div>
    );
};
