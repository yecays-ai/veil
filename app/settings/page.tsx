import Link from "next/link";
const futureSections = [
  "Presets",
  "World Books",
  "Regex",
  "Bindings",
  "Data & Storage",
  "About",
];
export default function Page() {
  return (
    <div className="settings-app">
      <Link className="back-link" href="/">
        ‹ Home
      </Link>
      <h1>Settings</h1>
      <nav aria-label="Settings sections">
        <Link className="settings-row" href="/settings/text-api">
          <strong>Text API</strong>
          <span>Named text providers and connection settings ›</span>
        </Link>
        {futureSections.map((section) => (
          <div className="settings-row" key={section}>
            <strong>{section}</strong>
            <span>Coming later</span>
          </div>
        ))}
      </nav>
    </div>
  );
}
