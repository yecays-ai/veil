import type { ReactNode } from "react";

export function Alert({
  variant = "info",
  children,
}: {
  variant?: "info" | "success" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      className="settings-alert"
      data-variant={variant}
      role={variant === "danger" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
