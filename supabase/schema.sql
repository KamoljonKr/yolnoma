-- Yoʻlnoma: rejalarni ikkala qurilmada bir xil saqlash uchun jadvallar.
-- Supabase → SQL Editor → New query → Run. Har bir foydalanuvchi faqat oʻz qatorlarini koʻradi (RLS).

create table if not exists public.plans (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  data jsonb not null,
  dist integer not null default 0,
  dur integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);
alter table public.plans enable row level security;
create policy "plans_select" on public.plans for select using (user_id = auth.uid());
create policy "plans_insert" on public.plans for insert with check (user_id = auth.uid());
create policy "plans_update" on public.plans for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "plans_delete" on public.plans for delete using (user_id = auth.uid());

create table if not exists public.plan_state (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  current_plan text,
  updated_at timestamptz not null default now()
);
alter table public.plan_state enable row level security;
create policy "state_select" on public.plan_state for select using (user_id = auth.uid());
create policy "state_insert" on public.plan_state for insert with check (user_id = auth.uid());
create policy "state_update" on public.plan_state for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "state_delete" on public.plan_state for delete using (user_id = auth.uid());
