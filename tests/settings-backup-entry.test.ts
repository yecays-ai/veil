import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsPage = readFileSync("app/settings/page.tsx", "utf8");
const backupPage = readFileSync("app/settings/backup/page.tsx", "utf8");
const backupSettings = readFileSync("components/settings/backup-restore.tsx", "utf8");

test("Settings links to the Backup & Restore page", () => {
  assert.match(settingsPage, /label: "Backup & Restore"/);
  assert.match(settingsPage, /href: "\/settings\/backup"/);
  assert.match(backupPage, /title="Backup &amp; Restore"|title="Backup & Restore"/);
  assert.match(backupPage, /backHref="\/settings"/);
});

test("backup actions are wired to the backup flow and no longer disabled placeholders", () => {
  for (const label of ["Export Backup", "Import Backup"]) assert.match(backupSettings, new RegExp(`<strong>${label}</strong>`));
  assert.doesNotMatch(backupSettings, /Coming Soon|Not available yet\./);
  assert.match(backupSettings, /lib\/backup\/backup-flow/);
  assert.match(backupSettings, /accept="\.zip,application\/zip"/);
});
