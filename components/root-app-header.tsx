import Link from "next/link";
import { Chevron } from "./page-shell";

export function RootAppHeader({ title, className = "", rightAction }: {
  title: string; className?: string; rightAction?: React.ReactNode;
}) {
  return <header className={`root-app-header ${className}`}>
    <Link className="app-page-back" href="/" aria-label="Back to Home"><Chevron /></Link>
    <h1>{title}</h1>
    {rightAction}
  </header>;
}
