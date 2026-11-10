import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("the service worker does not intercept cloud requests or recovery URLs", async () => {
  const code = await readFile(
    new URL("../public/sw.js", import.meta.url),
    "utf8",
  );
  const handlers = new Map();
  const origin = "https://lumina.example";
  runInNewContext(code, {
    URL,
    self: {
      location: { origin },
      addEventListener: (name, fn) => handlers.set(name, fn),
    },
  });
  const entries = [
    ["https://test.supabase.co/rest/v1/lumina_documents", "cors", "", true],
    [
      "https://test.supabase.co/storage/v1/object/lumina-private-photos/file.jpg",
      "cors",
      "",
      true,
    ],
    [origin + "/?code=fake-recovery", "navigate", "document", false],
    [origin + "/assets/auth.js", "cors", "script", true],
  ];
  for (const [url, mode, destination, authorized] of entries) {
    let intercepted = false;
    handlers.get("fetch")({
      request: {
        url,
        method: "GET",
        mode,
        destination,
        headers: { has: () => authorized },
      },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, url);
  }
});
