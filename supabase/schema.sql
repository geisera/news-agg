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
as $
declare article_count bigint; story_count bigint; run_count bigint; x_queue_count bigint;
begin
 select count(*) into article_count from public.articles;
 select count(*) into story_count from public.stories;
 select count(*) into run_count from public.collection_runs;
 select count(*) into x_queue_count from public.x_article_posts;
 -- Include both queue generations to satisfy foreign keys when truncating articles/stories.
 truncate table public.x_article_posts,public.x_posts,public.articles,public.stories,public.collection_runs;
 -- Preserve OAuth and settings; make the first new article immediately eligible.
 update public.x_schedule set next_due_at=now(),updated_at=now() where id=1;
 return jsonb_build_object('articles',article_count,'stories',story_count,'collectionRuns',run_count,'xQueuedArticles',x_queue_count);
end; $;
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

-- Independent article-level X queue and approximately hourly randomized cadence.
create table if not exists public.x_article_posts(
 article_id uuid primary key references public.articles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','review')),
 tweet_id text unique,attempts integer not null default 0,last_error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.x_schedule(
 id integer primary key default 1 check(id=1),
 next_due_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
insert into public.x_schedule(id) values(1) on conflict do nothing;
alter table public.x_article_posts enable row level security;
alter table public.x_schedule enable row level security;
revoke all on public.x_article_posts,public.x_schedule from anon,authenticated;
-- Preserve previous successful posts when migrating canonical story articles.
insert into public.x_article_posts(article_id,status,tweet_id,attempts,last_error,created_at,updated_at)
select s.canonical_article_id,p.status,p.tweet_id,p.attempts,p.last_error,p.created_at,p.updated_at
from public.x_posts p join public.stories s on s.id=p.story_id
join public.articles a on a.id=s.canonical_article_id
where s.canonical_article_id is not null on conflict(article_id) do nothing;
insert into public.x_article_posts(article_id,status)
select id,'pending' from public.articles where status='published'
on conflict(article_id) do nothing;
create or replace function public.claim_due_x_article() returns uuid
language plpgsql security definer set search_path=public as $$
declare picked uuid;due timestamptz;cap integer;enabled_flag boolean;
begin
 select enabled,daily_limit into enabled_flag,cap from x_settings where id=1;
 if not coalesce(enabled_flag,false) or cap=0 then return null;end if;
 perform 1 from x_schedule where id=1 for update;
 select next_due_at into due from x_schedule where id=1;
 if due>now() then return null;end if;
 if (select count(*) from x_article_posts where status in ('sent','sending')
     and updated_at>=date_trunc('day',now()))>=cap then return null;end if;
 select p.article_id into picked from x_article_posts p join articles a on a.id=p.article_id
 where p.status='pending' and a.status='published'
 order by a.published_at asc nulls last,p.created_at asc
 for update of p skip locked limit 1;
 if picked is not null then
  update x_article_posts set status='sending',attempts=attempts+1,updated_at=now()
  where article_id=picked;
  update x_schedule set next_due_at=now()+(interval '50 minutes'+random()*interval '20 minutes'),
   updated_at=now() where id=1;
 end if;
 return picked;
end $$;
revoke all on function public.claim_due_x_article() from public,anon,authenticated;
grant execute on function public.claim_due_x_article() to service_role;

-- Ranked rolling X shortlist and Eastern calendar daily cap.
CREATE OR REPLACE FUNCTION public.refresh_x_shortlist()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
 with ranked as (
 select a.id,a.story_id,row_number() over (partition by coalesce(a.story_id::text,a.id::text) order by (coalesce(a.significance,0)*0.35+coalesce(a.relevance,0)*0.25+greatest(0,100-extract(epoch from (now()-coalesce(a.published_at,a.created_at)))/86400*10)*0.20+coalesce(a.top_score,0)*0.20) desc,a.published_at desc nulls last) as story_rank,
 (coalesce(a.significance,0)*0.35+coalesce(a.relevance,0)*0.25+greatest(0,100-extract(epoch from (now()-coalesce(a.published_at,a.created_at)))/86400*10)*0.20+coalesce(a.top_score,0)*0.20) as score
 from articles a
 where a.status='published' and coalesce(a.published_at,a.created_at)>=now()-interval '7 days'
 and not exists(select 1 from x_article_posts xp where xp.article_id=a.id and xp.status in ('sent','sending','review','failed'))
 and not exists(select 1 from x_article_posts xp join articles old on old.id=xp.article_id where xp.status in ('sent','sending','review') and a.story_id is not null and old.story_id=a.story_id)
 ), chosen as (
 select id from ranked where story_rank=1 order by score desc,id limit 5
 )
 delete from x_article_posts p where p.status='pending' and not exists(select 1 from chosen where id=p.article_id);
 with ranked as (
 select a.id,a.story_id,row_number() over (partition by coalesce(a.story_id::text,a.id::text) order by (coalesce(a.significance,0)*0.35+coalesce(a.relevance,0)*0.25+greatest(0,100-extract(epoch from (now()-coalesce(a.published_at,a.created_at)))/86400*10)*0.20+coalesce(a.top_score,0)*0.20) desc,a.published_at desc nulls last) as story_rank,
 (coalesce(a.significance,0)*0.35+coalesce(a.relevance,0)*0.25+greatest(0,100-extract(epoch from (now()-coalesce(a.published_at,a.created_at)))/86400*10)*0.20+coalesce(a.top_score,0)*0.20) as score
 from articles a where a.status='published' and coalesce(a.published_at,a.created_at)>=now()-interval '7 days'
 and not exists(select 1 from x_article_posts xp where xp.article_id=a.id and xp.status in ('sent','sending','review','failed'))
 and not exists(select 1 from x_article_posts xp join articles old on old.id=xp.article_id where xp.status in ('sent','sending','review') and a.story_id is not null and old.story_id=a.story_id)
 ),chosen as (select id from ranked where story_rank=1 order by score desc,id limit 5)
 insert into x_article_posts(article_id,status) select id,'pending' from chosen on conflict(article_id) do nothing;
 select count(*) into n from x_article_posts where status='pending';
 return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.claim_due_x_article()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare picked uuid;due timestamptz;cap integer;enabled_flag boolean;day_start timestamptz;day_end timestamptz;
begin
 select enabled,least(daily_limit,5) into enabled_flag,cap from x_settings where id=1;
 if not coalesce(enabled_flag,false) or cap=0 then return null;end if;
 perform 1 from x_schedule where id=1 for update;
 select next_due_at into due from x_schedule where id=1;
 if due>now() then return null;end if;
 day_start := date_trunc('day',now() at time zone 'America/New_York') at time zone 'America/New_York';
 day_end := (date_trunc('day',now() at time zone 'America/New_York')+interval '1 day') at time zone 'America/New_York';
 if (select count(*) from x_article_posts where status in ('sent','sending','review') and updated_at>=day_start and updated_at<day_end)>=cap then return null;end if;
 perform public.refresh_x_shortlist();
 select p.article_id into picked from x_article_posts p join articles a on a.id=p.article_id where p.status='pending' and a.status='published'
 order by (coalesce(a.significance,0)*0.35+coalesce(a.relevance,0)*0.25+greatest(0,100-extract(epoch from (now()-coalesce(a.published_at,a.created_at)))/86400*10)*0.20+coalesce(a.top_score,0)*0.20) desc,p.created_at asc
 for update of p skip locked limit 1;
 if picked is not null then
 update x_article_posts set status='sending',attempts=attempts+1,updated_at=now() where article_id=picked;
 update x_schedule set next_due_at=now()+(interval '50 minutes'+random()*interval '20 minutes'),updated_at=now() where id=1;
 end if;
 return picked;
end $function$
;
revoke all on function public.refresh_x_shortlist() from public,anon,authenticated;
grant execute on function public.refresh_x_shortlist() to service_role;
revoke all on function public.claim_due_x_article() from public,anon,authenticated;
grant execute on function public.claim_due_x_article() to service_role;
update public.x_settings set daily_limit=least(daily_limit,5) where id=1;
