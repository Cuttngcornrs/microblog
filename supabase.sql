-- MICROBLOG DATABASE SETUP
-- Run this whole file in Supabase Dashboard -> SQL Editor.
-- It creates the tables, automatic profiles, indexes, and RLS policies.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'user' check (char_length(display_name) between 1 and 32),
  username text unique check (username is null or (char_length(username) between 1 and 24 and username ~ '^[a-zA-Z0-9_]+$')),
  role text not null default 'user' check (role in ('user', 'owner')),
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists posts_author_id_idx on public.posts(author_id);
create index if not exists comments_post_id_idx on public.comments(post_id, created_at);
create index if not exists comments_user_id_idx on public.comments(user_id);

-- Automatically create a public profile whenever an Auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1), 'user')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Helper used by RLS. The security-definer function avoids recursive policy checks.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;

-- Public profiles; only the profile owner may edit their own display info.
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public"
on public.profiles for select
to anon, authenticated
using (true);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id and role = (select role from public.profiles where id = (select auth.uid())));

-- Public feed.
drop policy if exists "posts are public" on public.posts;
create policy "posts are public"
on public.posts for select
to anon, authenticated
using (true);

-- Only the owner can publish or modify/delete posts.
drop policy if exists "owner can insert posts" on public.posts;
create policy "owner can insert posts"
on public.posts for insert
to authenticated
with check ((select auth.uid()) = author_id and (select public.is_owner()));

drop policy if exists "owner can update posts" on public.posts;
create policy "owner can update posts"
on public.posts for update
to authenticated
using ((select public.is_owner()) and (select auth.uid()) = author_id)
with check ((select public.is_owner()) and (select auth.uid()) = author_id);

drop policy if exists "owner can delete posts" on public.posts;
create policy "owner can delete posts"
on public.posts for delete
to authenticated
using ((select public.is_owner()) or (select auth.uid()) = author_id);

-- Comments are public to read. Signed-in users can add their own;
-- users can remove their own and the owner can remove any.
drop policy if exists "comments are public" on public.comments;
create policy "comments are public"
on public.comments for select
to anon, authenticated
using (true);

drop policy if exists "signed in users can comment" on public.comments;
create policy "signed in users can comment"
on public.comments for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users can delete own comments" on public.comments;
create policy "users can delete own comments"
on public.comments for delete
to authenticated
using ((select auth.uid()) = user_id or (select public.is_owner()));

-- Keep exposed table privileges least-privilege.
revoke all on table public.profiles, public.posts, public.comments from anon;
revoke all on table public.profiles, public.posts, public.comments from authenticated;

grant select on table public.profiles, public.posts, public.comments to anon;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.posts to authenticated;
grant select, insert, delete on table public.comments to authenticated;

-- IMPORTANT: after your first account exists, run this once with its real email:
-- update public.profiles p
-- set role = 'owner'
-- from auth.users u
-- where p.id = u.id and u.email = 'YOUR_EMAIL@example.com';
