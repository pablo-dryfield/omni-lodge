import { useEffect, useRef } from "react";
import { Button, Stack, Text } from "@mantine/core";
import { BookingCell } from "../utils/prepareBookingGrid";

type BookingPopupProps = {
  cell: BookingCell;
  onClose?: () => void;
  onViewManifest?: () => void;
};

const formatPeopleSummary = (cell: BookingCell): string => {
  if (cell.undefinedCount > 0 && cell.menCount === 0 && cell.womenCount === 0) {
    return `${cell.totalPeople} people (Undefined Genre: ${cell.undefinedCount})`;
  }
  if (cell.undefinedCount > 0) {
    return `${cell.totalPeople} people (Men: ${cell.menCount}, Women: ${cell.womenCount}, Undefined: ${cell.undefinedCount})`;
  }
  if (cell.menCount === 0 && cell.womenCount === 0) {
    return `${cell.totalPeople} people`;
  }
  return `${cell.totalPeople} people (Men: ${cell.menCount}, Women: ${cell.womenCount})`;
};

const isAddonOnlyOrder = (order: BookingCell["orders"][number]): boolean =>
  Boolean(order.isAddonOnly || order.bookingKind === "addon_only");

const isCountableOrder = (order: BookingCell["orders"][number]): boolean =>
  order.status === "confirmed" || order.status === "amended";

const formatBookingAndUpgradeCount = (cell: BookingCell): string => {
  const activeOrders = cell.orders.filter(isCountableOrder);
  const reservationCount = activeOrders.filter((order) => !isAddonOnlyOrder(order)).length;
  const upgradeCount = activeOrders.filter(isAddonOnlyOrder).length;
  const parts: string[] = [];
  if (reservationCount > 0) {
    parts.push(reservationCount === 1 ? "1 booking" : `${reservationCount} bookings`);
  }
  if (upgradeCount > 0) {
    parts.push(upgradeCount === 1 ? "1 upgrade" : `${upgradeCount} upgrades`);
  }
  return parts.length > 0 ? parts.join(" + ") : "No bookings";
};

export const BookingPopup = ({ cell, onClose, onViewManifest }: BookingPopupProps) => {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose?.();
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [onClose]);

  return (
    <div
      ref={popupRef}
      style={{
        position: "absolute",
        left: "calc(100% + 8px)",
        top: 0,
        zIndex: 1000,
        minWidth: 220,
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 18px 46px rgba(15, 23, 42, 0.18)",
        border: "1px solid #f0f0f5",
        padding: "14px 18px",
      }}
    >
      <Stack gap={10}>
        <div>
          <Text fw={700}>{cell.productName}</Text>
          <Text size="sm" c="dimmed">
            {cell.date} - {cell.time}
          </Text>
        </div>
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            {formatPeopleSummary(cell)}
          </Text>
          <Text size="xs" c="dimmed">
            {formatBookingAndUpgradeCount(cell)}
          </Text>
        </Stack>
        {onViewManifest && (
          <Button size="xs" variant="light" onClick={onViewManifest}>
            Open manifest
          </Button>
        )}
      </Stack>
    </div>
  );
};

