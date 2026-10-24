create extension if not exists pgcrypto;
create table if not exists site_settings (id integer primary key default 1 check (id=1),name text not null default 'Omar Report',topic_description text not null default '',include_rules text not null default '',exclude_rules text not null default '',relevance_threshold integer not null default 70 check(relevance_threshold between 0 and 100));
insert into site_settings(id) values (1) on conflict do nothing;
create table if not exists administrators(user_id uuid primary key references auth.users(id) on delete cascade);
create table if not exists sources(id uuid primary key default gen_random_uuid(),name text not null,feed_url text not null unique,site_url text,enabled boolean not null default true,image_license_ok boolean not null default false,last_checked_at timestamptz,last_error text,created_at timestamptz not null default now());
create table if not exists articles(id uuid primary key default gen_random_uuid(),source_id uuid not null references sources(id),title text not null,url text not null unique,description text,summary text,image_url text,image_allowed boolean not null default false,published_at timestamptz,created_at timestamptz not null default now(),relevance integer not null default 0,significance integer not null default 0,top_score numeric not null default 0,status text not null default 'review' check(status in ('published','review','rejected')),evaluation_reason text);
create index if not exists article_latest on articles(status,published_at desc);
create index if not exists article_top on articles(status,top_score desc);
create table if not exists collection_runs(id uuid primary key default gen_random_uuid(),started_at timestamptz not null default now(),finished_at timestamptz,articles_created integer not null default 0,errors jsonb not null default '[]'::jsonb);
alter table site_settings enable row level security;
alter table administrators enable row level security;
alter table sources enable row level security;
alter table articles enable row level security;
alter table collection_runs enable row level security;
-- All database operations are server-side with the service role; do not expose that key to browsers.
alter table site_settings add column if not exists articles_per_source integer not null default 20 check(articles_per_source between 1 and 50);

-- Preserve publisher attribution if approved RSS sources are removed.
alter table articles add column if not exists source_name text;
alter table articles alter column source_id drop not null;

-- Brave News Search configuration and search-only evaluation queue.
alter table site_settings add column if not exists search_queries text not null default '';
alter table site_settings add column if not exists search_freshness text not null default 'pw';
alter table site_settings add column if not exists search_result_limit integer not null default 20;
alter table articles add column if not exists search_discovered boolean not null default false;

-- Persistent story-level clustering (server-side writes only).
create table if not exists public.stories(id uuid primary key default gen_random_uuid(),slug text not null unique,headline text not null,canonical_article_id uuid,first_reported_at timestamptz,last_updated_at timestamptz not null default now(),created_at timestamptz not null default now());
alter table public.stories enable row level security;
alter table public.articles add column if not exists story_id uuid references public.stories(id) on delete set null;
create index if not exists articles_story_id_idx on public.articles(story_id);
create index if not exists stories_updated_idx on public.stories(last_updated_at desc);

-- Atomic reset of news content. Invocation restricted to service_role; admin auth checked in API.
create or replace function public.purge_news_content()
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare article_count bigint; story_count bigint; run_count bigint;
begin
 select count(*) into article_count from public.articles;
 select count(*) into story_count from public.stories;
 select count(*) into run_count from public.collection_runs;
 truncate table public.articles,public.stories,public.collection_runs;
 return jsonb_build_object('articles',article_count,'stories',story_count,'collectionRuns',run_count);
end; $$;
revoke all on function public.purge_news_content() from public,anon,authenticated;
grant execute on function public.purge_news_content() to service_role;

-- Admin request limiting and action audit (service-role only).
create table if not exists public.admin_audit_log(id bigint generated always as identity primary key,actor uuid not null,action text not null,created_at timestamptz not null default now());
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon,authenticated;
create index if not exists admin_audit_log_actor_created_idx on public.admin_audit_log(actor,created_at desc);
create table if not exists public.admin_request_limits(actor uuid primary key,window_start timestamptz not null default now(),requests integer not null default 0);
alter table public.admin_request_limits enable row level security;
revoke all on public.admin_request_limits from anon,authenticated;
create or replace function public.admin_rate_allowed(p_actor uuid) returns boolean language plpgsql security invoker set search_path='' as $$ declare n integer; begin insert into public.admin_request_limits(actor,window_start,requests) values(p_actor,now(),1) on conflict (actor) do update set window_start=case when public.admin_request_limits.window_start<now()-interval '1 minute' then now() else public.admin_request_limits.window_start end,requests=case when public.admin_request_limits.window_start<now()-interval '1 minute' then 1 else public.admin_request_limits.requests+1 end returning requests into n;return n<=60;end $$;
revoke all on function public.admin_rate_allowed(uuid) from public,anon,authenticated;
grant execute on function public.admin_rate_allowed(uuid) to service_role;

-- X publication queue (service-role only; disabled by default).
create table if not exists public.x_settings (
 id integer primary key default 1 check(id=1),
 enabled boolean not null default false,
 daily_limit integer not null default 5 check(daily_limit between 0 and 50),
 updated_at timestamptz not null default now()
);
insert into public.x_settings(id,enabled,daily_limit) values(1,false,5) on conflict(id) do nothing;
create table if not exists public.x_posts (
 story_id uuid primary key references public.stories(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','review')),
 tweet_id text unique,attempts integer not null default 0,
 last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.x_settings enable row level security;
alter table public.x_posts enable row level security;
revoke all on public.x_settings,public.x_posts from anon,authenticated;
create or replace function public.claim_x_post() returns uuid language plpgsql security definer set search_path=public as $$
declare picked uuid;
begin
 if not exists(select 1 from x_settings where id=1 and enabled) then return null;end if;
 if (select count(*) from x_posts where status in ('sent','sending') and updated_at>=date_trunc('day',now())) >= (select daily_limit from x_settings where id=1) then return null;end if;
 select story_id into picked from x_posts where status='pending' order by created_at for update skip locked limit 1;
 if picked is not null then update x_posts set status='sending',attempts=attempts+1,updated_at=now() where story_id=picked;end if;
 return picked;
end $$;
revoke all on function public.claim_x_post() from public,anon,authenticated;
grant execute on function public.claim_x_post() to service_role;

-- OAuth 2.0 user connection (encrypted using server-only X_TOKEN_ENCRYPTION_KEY).
create table if not exists public.x_oauth_connection(
 id integer primary key default 1 check(id=1),
 access_cipher text not null,
 refresh_cipher text not null,
 expires_at timestamptz not null,
 username text,
 updated_at timestamptz not null default now()
);
create table if not exists public.x_oauth_states(
 state_hash text primary key,
 verifier_cipher text not null,
 admin_id uuid not null,
 expires_at timestamptz not null
);
alter table public.x_oauth_connection enable row level security;
alter table public.x_oauth_states enable row level security;
revoke all on public.x_oauth_connection,public.x_oauth_states from anon,authenticated;
