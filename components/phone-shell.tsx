import type { ReactNode } from "react";

type PhoneShellProps = {
  children: ReactNode;
};

export function PhoneShell({ children }: PhoneShellProps) {
  return (
    <section className="phone-shell-wrap" aria-label="Companion phone">
      <div className="phone-case">
        <div className="phone-frame">
          <div className="phone-shell" data-ui="phone-screen">
            <div className="phone-content">{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
