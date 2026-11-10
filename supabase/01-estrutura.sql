-- LUMINA Nuvem. Execute no SQL Editor do seu projeto Supabase.
-- Pode executar novamente. As tabelas e os registros existentes são preservados.
begin;

create table if not exists public.lumina_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null check (
    jsonb_typeof(document) = 'object' and
    octet_length(document::text) <= 4194304
  ),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.lumina_documents enable row level security;
revoke all on public.lumina_documents from public, anon, authenticated;
grant select, insert, update on public.lumina_documents to authenticated;

drop policy if exists "Lumina lê seu documento" on public.lumina_documents;
create policy "Lumina lê seu documento"
  on public.lumina_documents for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Lumina cria seu documento" on public.lumina_documents;
create policy "Lumina cria seu documento"
  on public.lumina_documents for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Lumina edita seu documento" on public.lumina_documents;
create policy "Lumina edita seu documento"
  on public.lumina_documents for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Uma revisão divergente devolve zero linhas, preservando a edição mais recente.
create or replace function public.lumina_save_document(
  p_user_id uuid,
  p_document jsonb,
  p_expected_revision bigint
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or v_user is distinct from p_user_id then
    raise exception 'Entre na sua conta LUMINA.' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_document is null then
    raise exception 'Dados de sincronização inválidos.' using errcode = '22023';
  end if;
  if p_expected_revision = 0 then
    return query
      insert into public.lumina_documents as d (user_id, document)
      values (v_user, p_document)
      on conflict (user_id) do nothing
      returning d.revision, d.updated_at;
  else
    return query
      update public.lumina_documents as d
      set document = p_document, revision = d.revision + 1, updated_at = now()
      where d.user_id = v_user and d.revision = p_expected_revision
      returning d.revision, d.updated_at;
  end if;
end;
$$;

revoke all on function public.lumina_save_document(uuid, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.lumina_save_document(uuid, jsonb, bigint) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lumina-private-photos', 'lumina-private-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Lumina lê suas fotos" on storage.objects;
create policy "Lumina lê suas fotos"
  on storage.objects for select to authenticated
  using (bucket_id = 'lumina-private-photos' and
    (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Lumina envia suas fotos" on storage.objects;
create policy "Lumina envia suas fotos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'lumina-private-photos' and
    (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Lumina remove suas fotos" on storage.objects;
create policy "Lumina remove suas fotos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'lumina-private-photos' and
    (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
