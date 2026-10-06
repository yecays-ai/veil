import Link from "next/link";
import { Chevron } from "./page-shell";

export function RootAppHeader({ title, className = "", rightAction, backHref = "/", backLabel = "Back to Home" }: {
  title: string; className?: string; rightAction?: React.ReactNode; backHref?: string; backLabel?: string;
}) {
  return <header className={`root-app-header ${className}`}>
    <Link className="app-page-back" href={backHref} aria-label={backLabel}><Chevron /></Link>
    <h1>{title}</h1>
    {rightAction}
  </header>;
}
