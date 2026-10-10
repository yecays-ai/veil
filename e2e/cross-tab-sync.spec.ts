import { expect, test, type Page } from "@playwright/test";

// Two real pages of one browser context share IndexedDB and BroadcastChannel, like two tabs of one browser.
// Nothing is dispatched by hand and no model is called: Send saves a bubble and never requests a reply.

async function createCharacter(page: Page, name: string) {
  await page.goto("/characters/new");
  await page.getByLabel("Name").first().fill(name);
  await page.getByRole("button", { name: "Create Character" }).click();
  await page.waitForURL(/\/characters\/(?!new)[^/]+$/);
  return page.url().split("/").pop()!;
}

/** Reads a whole IndexedDB object store from inside the page, so a check covers stored data and not only the UI. */
async function readStore(page: Page, database: string, store: string) {
  return page.evaluate(([name, storeName]) => new Promise<unknown[]>((resolve, reject) => {
    const open = indexedDB.open(name);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
      const all = db.transaction(storeName).objectStore(storeName).getAll();
      all.onsuccess = () => { db.close(); resolve(all.result); };
      all.onerror = () => { db.close(); reject(all.error); };
    };
  }), [database, store]);
}

test("a message sent in one tab appears once in another tab, and is stored", async ({ context }) => {
  const first = await context.newPage();
  const id = await createCharacter(first, "Alice");
  const second = await context.newPage();
  await first.goto(`/messages/${id}`);
  await second.goto(`/messages/${id}`);
  await expect(first.locator("#chat-input")).toBeVisible();
  await expect(second.locator("#chat-input")).toBeVisible();

  await first.locator("#chat-input").fill("hello from the first tab");
  await first.getByRole("button", { name: "Send" }).click();

  await expect(first.getByText("hello from the first tab")).toHaveCount(1);
  await expect(second.getByText("hello from the first tab")).toHaveCount(1); // arrived without a reload
  const messages = await readStore(second, "veil-chat-v2", "messages") as { content?: string }[];
  expect(messages.filter((message) => message.content === "hello from the first tab")).toHaveLength(1);
});

test("renaming a character in one tab updates another tab, and is stored", async ({ context }) => {
  const first = await context.newPage();
  const id = await createCharacter(first, "Alice");
  const second = await context.newPage();
  await second.goto("/characters");
  await expect(second.getByText("Alice")).toBeVisible();

  await first.goto(`/characters/${id}`);
  await first.getByRole("button", { name: "Edit" }).click();
  await first.getByLabel("Name").first().fill("Alicia");
  await first.getByRole("button", { name: /^Save/ }).click();

  await expect(second.getByText("Alicia")).toBeVisible(); // arrived without a reload
  await expect(second.getByText("Alice", { exact: true })).toHaveCount(0);
  const documents = await readStore(second, "veil-core-v1", "documents");
  expect(JSON.stringify(documents)).toContain("Alicia");
});
