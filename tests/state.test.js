import test from "node:test";
import assert from "node:assert/strict";
import { initialState, normalizeState, parseBackup } from "../src/state.js";
import { isPublicKey, readCloudConfig } from "../src/config.js";

test("a version 1 backup retains areas, habits, entries and portable image bytes", () => {
  const raw = {
    app: "LUMINA",
    state: {
      version: 1,
      profile: {
        name: "Teste",
        avatar: "Lumi",
        accent: "#7c5cff",
        sound: false,
      },
      areas: [
        {
          id: "area_old",
          name: "Estudo",
          color: "#886699",
          current: 6,
          target: 9,
        },
      ],
      habits: [
        {
          id: "habit_old",
          title: "Ler",
          areaId: "area_old",
          logs: ["2026-11-09"],
        },
      ],
      journal: [
        {
          id: "entry_old",
          date: "2026-11-10",
          fact: "Escrevi hoje",
          energy: 7,
        },
      ],
    },
    photos: [
      {
        id: "photo_old",
        title: "Foto",
        dataUrl: "data:image/jpeg;base64,/9j/2Q==",
      },
    ],
  };
  const migrated = parseBackup(raw);
  assert.equal(migrated.state.version, 2);
  assert.equal(migrated.state.profile.name, "Teste");
  assert.equal(migrated.state.profile.sound, false);
  assert.equal(migrated.state.areas[0].id, "area_old");
  assert.deepEqual(migrated.state.habits[0].logs, ["2026-11-09"]);
  assert.equal(migrated.state.journal[0].fact, "Escrevi hoje");
  assert.equal(migrated.photos[0].dataUrl, raw.photos[0].dataUrl);
  assert.deepEqual(migrated.state.dreams, []);
});

test("backup rejects unsafe IDs, invalid photo formats and unrelated documents", () => {
  const doc = initialState();
  assert.throws(
    () =>
      parseBackup({
        state: doc,
        photos: [{ id: "p", dataUrl: "data:text/html;base64,AA==" }],
      }),
    /imagens/,
  );
  assert.throws(
    () => normalizeState({ ...doc, areas: [{ id: '" onclick="x' }] }),
    /Identificador/,
  );
  assert.throws(() => parseBackup({ notes: [] }), /backup/);
});

test("only publishable or legacy anon keys can configure the client", () => {
  const token = (role) =>
    "a." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".b";
  assert.equal(isPublicKey("sb_publishable_fictitious"), true);
  assert.equal(isPublicKey("sb_secret_fictitious"), false);
  assert.equal(isPublicKey(token("service_role")), false);
  assert.equal(isPublicKey(token("anon")), true);
  assert.equal(
    readCloudConfig("https://x.supabase.co/auth/v1", token("anon")),
    null,
  );
  assert.deepEqual(readCloudConfig("https://x.supabase.co", token("anon")), {
    url: "https://x.supabase.co",
    key: token("anon"),
  });
});
