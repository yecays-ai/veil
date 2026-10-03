import Link from "next/link";

export default function MessagesPage() {
  return (
    <div className="theme-page">
      <Link className="back-link" href="/">← Home</Link>
      <h1>Messages</h1>
      <p className="empty-state">No messages yet.</p>
    </div>
  );
}
