-- One-time setup for post likes.
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_user_id_idx
  on public.post_likes(user_id);

alter table public.post_likes enable row level security;

drop policy if exists "post likes are public" on public.post_likes;
create policy "post likes are public"
on public.post_likes for select
to anon, authenticated
using (true);

drop policy if exists "signed in users can like posts" on public.post_likes;
create policy "signed in users can like posts"
on public.post_likes for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users can remove their own likes" on public.post_likes;
create policy "users can remove their own likes"
on public.post_likes for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.post_likes from anon, authenticated;
grant select on table public.post_likes to anon, authenticated;
grant insert, delete on table public.post_likes to authenticated;
