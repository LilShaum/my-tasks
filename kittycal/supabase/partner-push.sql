-- KittyCal partner notifications.
--
-- Applied with the Supabase connector; safe to run more than once. Nothing
-- here touches any table that is not KittyCal's.
--
-- How it works, and what the server learns:
--   * His phone works out when the next heads-ups are due (the evening before
--     her period is likely, and the morning her harder days usually start) and
--     what each will say. It keeps the words. It sends only its push address
--     and the times, via kittycal_push_register.
--   * Every five minutes a cron job calls the kittycal-push edge function,
--     which takes the due times (kittycal_push_take_due) and sends each phone
--     an empty push. The phone wakes, finds the heads-up it scheduled for about
--     now, and shows it.
--   * So the server knows a phone wants waking at certain times, and nothing
--     about why: no names, no dates of anything, no text.
--
-- The VAPID private key that signs pushes lives in Supabase Vault
-- (name 'kittycal_vapid_private'), readable only through
-- kittycal_push_vapid(), which only the service role may call.

create table if not exists public.kittycal_push_subs (
  endpoint    text primary key check (char_length(endpoint) between 20 and 600 and endpoint like 'https://%'),
  share_id    text not null check (char_length(share_id) between 16 and 64),
  p256dh      text not null check (char_length(p256dh) < 200),
  auth        text not null check (char_length(auth) < 100),
  created_at  timestamptz not null default now()
);

create table if not exists public.kittycal_push_jobs (
  id        bigserial primary key,
  endpoint  text not null references public.kittycal_push_subs(endpoint) on delete cascade,
  send_at   timestamptz not null
);
create index if not exists kittycal_push_jobs_due on public.kittycal_push_jobs (send_at);

alter table public.kittycal_push_subs enable row level security;
alter table public.kittycal_push_jobs enable row level security;
revoke all on public.kittycal_push_subs from anon, authenticated;
revoke all on public.kittycal_push_jobs from anon, authenticated;

-- His phone: remember this push address for her share, and replace its
-- schedule with these times. Only for a share that exists; at most twelve
-- times, all within the next four months.
create or replace function public.kittycal_push_register(p_share_id text, p_endpoint text, p_p256dh text, p_auth text, p_times timestamptz[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.kittycal_shares where id = p_share_id) then raise exception 'no such share'; end if;
  if coalesce(array_length(p_times, 1), 0) > 12 then raise exception 'too many times'; end if;
  if not exists (select 1 from public.kittycal_push_subs where endpoint = p_endpoint)
     and (select count(*) from public.kittycal_push_subs) >= 2000 then raise exception 'too many subscriptions'; end if;
  insert into public.kittycal_push_subs (endpoint, share_id, p256dh, auth) values (p_endpoint, p_share_id, p_p256dh, p_auth)
    on conflict (endpoint) do update set share_id = excluded.share_id, p256dh = excluded.p256dh, auth = excluded.auth;
  perform public.kittycal_push_schedule(p_endpoint, p_times);
end;
$$;

-- Internal: replace one phone's schedule. Not callable from outside.
create or replace function public.kittycal_push_schedule(p_endpoint text, p_times timestamptz[])
returns void language sql security definer set search_path = public as $$
  delete from public.kittycal_push_jobs where endpoint = p_endpoint;
  insert into public.kittycal_push_jobs (endpoint, send_at)
    select p_endpoint, t from unnest(coalesce(p_times, array[]::timestamptz[])) as t
    where t > now() and t < now() + interval '120 days';
$$;

-- His phone: stop. Also used by the sender when a push service says the
-- address is gone.
create or replace function public.kittycal_push_forget(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.kittycal_push_subs where endpoint = p_endpoint;
$$;

-- The sender: everything due, once. Anything more than twelve hours late is
-- dropped rather than sent: a heads-up for yesterday is noise.
create or replace function public.kittycal_push_take_due()
returns table (endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = public
as $$
  with due as (
    delete from public.kittycal_push_jobs j
    where j.send_at <= now()
    returning j.endpoint, j.send_at
  )
  select distinct s.endpoint, s.p256dh, s.auth
  from due d join public.kittycal_push_subs s on s.endpoint = d.endpoint
  where d.send_at > now() - interval '12 hours';
$$;

-- The sender: the key that signs pushes, from Vault.
create or replace function public.kittycal_push_vapid()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select decrypted_secret::jsonb from vault.decrypted_secrets where name = 'kittycal_vapid_private' limit 1;
$$;

revoke all on function public.kittycal_push_register(text, text, text, text, timestamptz[]) from public;
revoke all on function public.kittycal_push_forget(text) from public;
revoke all on function public.kittycal_push_schedule(text, timestamptz[]) from public, anon, authenticated;
revoke all on function public.kittycal_push_take_due() from public, anon, authenticated;
revoke all on function public.kittycal_push_vapid() from public, anon, authenticated;
grant execute on function public.kittycal_push_register(text, text, text, text, timestamptz[]) to anon, authenticated;
grant execute on function public.kittycal_push_forget(text) to anon, authenticated, service_role;
grant execute on function public.kittycal_push_take_due() to service_role;
grant execute on function public.kittycal_push_vapid() to service_role;

-- Extensions and the timer. Every five minutes, but only when something is
-- due, the database calls the sender. The bearer is the project's public
-- (anon) key: the function only sends what is already due, so being able to
-- call it gains nobody anything.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
-- select cron.schedule('kittycal-push', '*/5 * * * *', $cron$
--   select net.http_post(
--     url := 'https://uepxpnqgrwvqruzexxsg.supabase.co/functions/v1/kittycal-push',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <anon key>'),
--     body := jsonb_build_object('at', now()))
--   where exists (select 1 from public.kittycal_push_jobs where send_at <= now());
-- $cron$);
