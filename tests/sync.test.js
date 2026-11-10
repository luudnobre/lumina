import test from "node:test";
import assert from "node:assert/strict";
import { DocumentSync } from "../src/sync.js";

function memoryDraft(initial = null) {
  let value = initial;
  return {
    read: () => value,
    write: (revision, state) => {
      value = structuredClone({ revision, state });
    },
    clear: () => {
      value = null;
    },
  };
}
function cloud(initial) {
  let row = initial;
  const writes = [];
  return {
    read: async () => structuredClone(row),
    write: async (state, expected) => {
      writes.push(expected);
      if (expected !== (row?.revision ?? 0)) return null;
      row = {
        revision: expected + 1,
        state: structuredClone(state),
        updatedAt: "2026-11-10T00:00:00Z",
      };
      return { revision: row.revision, updatedAt: row.updatedAt };
    },
    writes,
  };
}

test("an old draft stays blocked after edits and reload until the user chooses a version", async () => {
  const remote = cloud({ revision: 5, state: { dream: "latest" } });
  const draft = memoryDraft({ revision: 3, state: { dream: "local" } });
  const first = new DocumentSync({ remote, draft });
  assert.deepEqual(await first.start({}), { dream: "local" });
  assert.equal(await first.queue({ dream: "local edited" }), false);
  assert.equal(draft.read().revision, 3);
  first.close();

  let applied;
  const next = new DocumentSync({
    remote,
    draft,
    onApply: (state) => {
      applied = state;
    },
  });
  await next.start({});
  assert.equal(next.conflict, true);
  assert.equal(await next.flush(), false);
  assert.deepEqual(remote.writes, []);
  assert.equal(await next.resolve("cloud", {}), true);
  assert.deepEqual(applied, { dream: "latest" });
  assert.equal(draft.read(), null);
});

test("concurrent edits from the same tab serialize and use the acknowledged revision", async () => {
  const remote = cloud(null);
  const draft = memoryDraft();
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const write = remote.write;
  remote.write = async (state, revision) => {
    if (revision === 0) await hold;
    return write(state, revision);
  };
  const sync = new DocumentSync({ remote, draft });
  await sync.start({});
  const first = sync.queue({ dream: "one" });
  const second = sync.queue({ dream: "two" });
  assert.equal(draft.read().state.dream, "two");
  release();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(remote.writes, [0, 1]);
  assert.equal((await remote.read()).state.dream, "two");
  assert.equal(draft.read(), null);
});

test("a failed save retains the draft and can be retried", async () => {
  const remote = cloud(null);
  const write = remote.write;
  remote.write = async () => {
    throw new Error("network");
  };
  const draft = memoryDraft();
  const sync = new DocumentSync({ remote, draft });
  await sync.start({});
  assert.equal(await sync.queue({ dream: "pending" }), false);
  assert.deepEqual(draft.read(), { revision: 0, state: { dream: "pending" } });
  remote.write = write;
  assert.equal(await sync.flush(), true);
  assert.equal((await remote.read()).state.dream, "pending");
});

test("a second browser reads a saved change and a stale write cannot overwrite it", async () => {
  const remote = cloud({ revision: 1, state: { dream: "original" } });
  let applied;
  const a = new DocumentSync({ remote, draft: memoryDraft() });
  const b = new DocumentSync({
    remote,
    draft: memoryDraft(),
    onApply: (state) => {
      applied = state;
    },
  });
  await a.start({});
  await b.start({});
  await a.queue({ dream: "first browser" });
  await b.refresh(() => false);
  assert.equal(applied, undefined);
  assert.equal(await b.queue({ dream: "second browser" }), false);
  assert.equal((await remote.read()).state.dream, "first browser");
  await b.resolve("cloud", {});
  assert.equal(applied.dream, "first browser");
  await a.queue({ dream: "new change" });
  await b.refresh();
  assert.equal(applied.dream, "new change");
});
