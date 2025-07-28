import React, { useRef, useEffect } from "react";
import { BookingCell } from "../utils/prepareBookingGrid";

interface BookingPopupProps {
  style?: React.CSSProperties;
  cell: BookingCell;
  onClose?: () => void;
}

export const BookingPopup: React.FC<BookingPopupProps> = ({
  style = {},
  cell,
  onClose,
}) => {
  // 1. Create a ref for the popup
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 2. Click handler
    function handleClickOutside(event: MouseEvent) {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        if (onClose) onClose();
      }
    }
    // 3. Listen for mousedown (can use pointerdown for even better UX)
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={popupRef}
      style={{
        position: "absolute",
        left: "calc(100% + 6px)",
        top: 0,
        zIndex: 1000,
        minWidth: 150,
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 4px 24px 0 rgba(44, 62, 80, 0.17)",
        border: "1px solid #e9e9e9",
        padding: "13px 0 0 0",
        fontFamily: "inherit",
        ...style,
      }}
    >
      {/* Triangle pointer, top left side */}
      <div
        style={{
          position: "absolute",
          top: 7,
          left: -14,
          width: 0,
          height: 0,
          borderTop: "11px solid transparent",
          borderBottom: "11px solid transparent",
          borderRight: "14px solid #fff",
          filter: "drop-shadow(0 1px 2px #e9e9e9)",
          zIndex: 1001,
        }}
      />
      {/* Close button (optional) */}
      {onClose && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 16,
            cursor: "pointer",
            fontSize: 19,
            color: "#bbb",
          }}
          onClick={onClose}
        >
          ×
        </div>
      )}
      {/* Popup content */}
      <div style={{ padding: "0 5px 4px 9px" }}>
        <div
          style={{
            fontSize: 16,
            color: "#444",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span style={{ fontSize: 17, color: "#1d2025" }}>🗒️</span>
          Manifest
        </div>
      </div>
      {/* Footer stats */}
      <div
        style={{
          background: "#e9f8f1",
          borderBottomLeftRadius: 8,
          borderBottomRightRadius: 8,
          marginTop: 14,
          padding: "8px 16px 8px 16px",
          fontSize: 13,
          fontWeight: 500,
          borderTop: "1px solid #e2e8e9",
        }}
      >
        {/* MEN */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <span style={{ fontWeight: 700, color: "#444", minWidth: 55 }}>
            Men
          </span>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                background: "#22ad76",
                color: "#fff",
                borderRadius: 5,
                fontWeight: 700,
                fontSize: 15,
                textAlign: "center",
                lineHeight: "22px",
                marginRight: 3,
              }}
            ></span>
            45
          </div>
        </div>
        {/* WOMEN */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, color: "#444", minWidth: 55 }}>
            Women
          </span>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                background: "#929fa5",
                color: "#fff",
                borderRadius: 5,
                fontWeight: 700,
                fontSize: 15,
                textAlign: "center",
                lineHeight: "22px",
                marginRight: 3,
              }}
            ></span>
            15
          </div>
        </div>
      </div>
    </div>
  );
};
