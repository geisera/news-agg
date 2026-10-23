create extension if not exists pgcrypto;
create table if not exists site_settings (id integer primary key default 1 check (id=1),name text not null default 'Curated News',topic_description text not null default '',include_rules text not null default '',exclude_rules text not null default '',relevance_threshold integer not null default 70 check(relevance_threshold between 0 and 100));
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
