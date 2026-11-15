-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 80),
  url         text not null unique check (url ~* '^https?://' and char_length(url) <= 500),
  platform    text not null default 'other' check (platform in
              ('spawn','gdevelop','gearzero','unity','godot','playdrop','ludo','tesana','rosebud','refybe','other')),
  author      text not null default '' check (char_length(author) <= 60),
  description text not null default '' check (char_length(description) <= 400),
  cover       text not null default '' check (char_length(cover) <= 500),
  likes       integer not null default 0,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.games enable row level security;

-- Everyone can read games that are not hidden.
create policy "read visible games" on public.games
  for select to anon, authenticated using (hidden = false);

-- Everyone can add a game (but cannot pre-set likes or hidden).
create policy "anyone can add a game" on public.games
  for insert to anon, authenticated with check (hidden = false and likes = 0);

-- Likes go through a function so visitors can't edit anything else.
create or replace function public.like_game(game_id uuid, delta integer)
returns integer language sql security definer set search_path = public as $$
  update public.games
     set likes = greatest(0, likes + case when delta > 0 then 1 else -1 end)
   where id = game_id and hidden = false
  returning likes;
$$;

grant select, insert on public.games to anon, authenticated;
grant execute on function public.like_game(uuid, integer) to anon, authenticated;

-- Moderation: in Dashboard -> Table Editor -> games, tick "hidden" (or delete the row) to remove a game.
