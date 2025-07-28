import React from "react";
import { NavLink, NavLinkProps } from "@mantine/core";

interface ActiveNavLinkProps extends Omit<NavLinkProps, "label"> {
  active: boolean;
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick?: () => void;
  [key: string]: any;
}

export function ActiveNavLink({
  active,
  icon,
  label,
  onClick,
  ...rest
}: ActiveNavLinkProps) {
  return (
    <div style={{ position: "relative" }}>
      {/* The little blue pill for active */}
      {active && (
        <div
          style={{
            position: "absolute",
            left: "-20px",
            top: "50%",
            transform: "translateY(-50%)",
            width: 13,
            height: "80%",
            backgroundColor: "#0a6ece",
            borderTopRightRadius: 10,
            borderBottomRightRadius: 10,
            borderTopLeftRadius: 8,
            borderBottomLeftRadius: 8,
            zIndex: 2,
            boxShadow: "1px 0 4px 0 #99d1ff33",
          }}
        />
      )}
      <NavLink
        active={active}
        leftSection={icon}
        label={<span>{label}</span>}
        onClick={onClick}
        {...rest}
      />
    </div>
  );
}
