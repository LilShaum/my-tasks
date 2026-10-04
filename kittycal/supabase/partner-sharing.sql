-- KittyCal partner sharing.
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run more than once.
--
-- What it creates, and why it is safe to share a project with another app:
--   * One table, kittycal_shares, that nothing can read or write directly.
--   * Three functions, the only way in:
--       kittycal_get_share(id)            anyone with the link's id can read the
--                                         stored blob — which is encrypted on her
--                                         phone, with a key that never reaches
--                                         this server.
--       kittycal_put_share(id, token, blob)  creates a share, or updates one, but
--                                         only with the secret token her phone
--                                         made it with (stored here as a hash).
--       kittycal_delete_share(id, token)  stops sharing, with the same token.
--   * Nothing here touches any other table in the project.

create table if not exists public.kittycal_shares (
  id          text primary key check (char_length(id) between 16 and 64),
  token_hash  text not null,
  blob        text not null check (char_length(blob) < 20000),
  updated_at  timestamptz not null default now()
);

alter table public.kittycal_shares enable row level security;
revoke all on public.kittycal_shares from anon, authenticated;

create or replace function public.kittycal_get_share(p_id text)
returns table (blob text, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select s.blob, s.updated_at from public.kittycal_shares s where s.id = p_id;
$$;

create or replace function public.kittycal_put_share(p_id text, p_token text, p_blob text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hashed text := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  existing text;
begin
  if char_length(p_token) < 32 then
    raise exception 'token too short';
  end if;
  select s.token_hash into existing from public.kittycal_shares s where s.id = p_id;
  if existing is null then
    insert into public.kittycal_shares (id, token_hash, blob) values (p_id, hashed, p_blob);
  elsif existing = hashed then
    update public.kittycal_shares set blob = p_blob, updated_at = now() where id = p_id;
  else
    raise exception 'not allowed';
  end if;
end;
$$;

create or replace function public.kittycal_delete_share(p_id text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.kittycal_shares
  where id = p_id and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
end;
$$;

revoke all on function public.kittycal_get_share(text) from public;
revoke all on function public.kittycal_put_share(text, text, text) from public;
revoke all on function public.kittycal_delete_share(text, text) from public;
grant execute on function public.kittycal_get_share(text) to anon, authenticated;
grant execute on function public.kittycal_put_share(text, text, text) to anon, authenticated;
grant execute on function public.kittycal_delete_share(text, text) to anon, authenticated;
