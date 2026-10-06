import type { ChangeEvent } from "react";

export type SwitchProps = {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export function Switch({
  checked,
  disabled = false,
  onChange,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SwitchProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.currentTarget.checked);
  }

  return (
    <span className={`veil-switch${className ? ` ${className}` : ""}`}>
      <input
        className="veil-switch-input"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onChange={handleChange}
      />
      <span className="veil-switch-track" aria-hidden="true">
        <span className="veil-switch-thumb" />
      </span>
    </span>
  );
}
