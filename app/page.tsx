import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <h1>Companion Phone</h1>
      <nav aria-label="Apps">
        <Link className="app-link" href="/messages">Messages <span aria-hidden="true">→</span></Link>
      </nav>
    </>
  );
}
