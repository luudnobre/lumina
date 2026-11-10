import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const bucket = "lumina-private-photos";

test("Postgres enforces owner-only access, optimistic writes and private photo folders", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon; create role authenticated;" +
      "create schema auth; create table auth.users (id uuid primary key);" +
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;" +
      "grant usage on schema auth to anon, authenticated;" +
      "create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);" +
      "create table storage.objects (bucket_id text, name text, primary key (bucket_id, name));" +
      "create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1] $$;" +
      "alter table storage.objects enable row level security;" +
      "grant usage on schema storage to anon, authenticated;" +
      "grant select, insert, delete on storage.objects to anon, authenticated;",
  );
  await db.query("insert into auth.users (id) values ($1), ($2)", [a, b]);
  const migration = await readFile(
    new URL("../supabase/01-estrutura.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  const photoBucket = await db.query(
    "select public, file_size_limit from storage.buckets where id = $1",
    [bucket],
  );
  assert.equal(photoBucket.rows[0].public, false);
  assert.equal(Number(photoBucket.rows[0].file_size_limit), 5242880);

  async function authenticate(user) {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      user,
    ]);
  }
  const save = (user, revision, text) =>
    db.query(
      "select revision from public.lumina_save_document($1, $2::jsonb, $3)",
      [user, JSON.stringify({ text }), revision],
    );

  await authenticate(a);
  assert.equal(Number((await save(a, 0, "primeira")).rows[0].revision), 1);
  assert.equal(Number((await save(a, 1, "segunda")).rows[0].revision), 2);
  assert.equal((await save(a, 1, "antiga")).rows.length, 0);
  assert.equal((await save(a, 0, "reinserção")).rows.length, 0);
  await db.query("insert into storage.objects values ($1, $2)", [
    bucket,
    a + "/foto.jpg",
  ]);

  await authenticate(b);
  assert.deepEqual(
    (await db.query("select document from public.lumina_documents")).rows,
    [],
  );
  assert.deepEqual(
    (await db.query("select name from storage.objects")).rows,
    [],
  );
  await assert.rejects(
    save(a, 2, "sem permissão"),
    (error) => error.code === "42501",
  );
  await assert.rejects(
    db.query("insert into storage.objects values ($1, $2)", [
      bucket,
      a + "/outra.jpg",
    ]),
    (error) => error.code === "42501",
  );
  assert.equal(
    (
      await db.query(
        "delete from storage.objects where name = $1 returning name",
        [a + "/foto.jpg"],
      )
    ).rows.length,
    0,
  );
  assert.equal(Number((await save(b, 0, "conta B")).rows[0].revision), 1);
  await db.query("insert into storage.objects values ($1, $2)", [
    bucket,
    b + "/foto.jpg",
  ]);

  await authenticate(a);
  const result = await db.query("select document from public.lumina_documents");
  assert.deepEqual(result.rows, [{ document: { text: "segunda" } }]);
  const ownPhotos = await db.query("select name from storage.objects");
  assert.deepEqual(ownPhotos.rows, [{ name: a + "/foto.jpg" }]);

  await db.exec("reset role; set role anon");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await assert.rejects(
    db.query("select document from public.lumina_documents"),
    (error) => error.code === "42501",
  );
  await assert.rejects(
    save(a, 2, "anônima"),
    (error) => error.code === "42501",
  );
  assert.deepEqual(
    (await db.query("select name from storage.objects")).rows,
    [],
  );
});
