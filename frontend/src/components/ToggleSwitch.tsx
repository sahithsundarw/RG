import React from "react";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const ToggleSwitch: React.FC<Props> = ({ checked, onChange, disabled = false }) => {
  const handle = () => { if (!disabled) onChange(!checked); };

  return (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={disabled ? -1 : 0}
      onClick={handle}
      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); handle(); } }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? "#0F172A" : "#E2E8F0",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.2s",
        padding: "0 2px",
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        outline: "none",
        boxSizing: "border-box",
      }}
    >
      <div style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "#FFFFFF",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        transform: checked ? "translateX(20px)" : "translateX(0px)",
        transition: "transform 0.2s",
        flexShrink: 0,
      }} />
    </div>
  );
};
