create extension if not exists "uuid-ossp";

create table if not exists public.room_checklist (
  id uuid primary key default uuid_generate_v4(),
  room text not null,
  code text,
  room_type text,
  checklist_date date not null,
  area text,
  utility text not null default '',
  condition text not null default 'NORMAL',
  notes text,
  update_smarthome boolean not null default false,
  sort_no integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.room_checklist add column if not exists code text;
alter table public.room_checklist add column if not exists room_type text;
alter table public.room_checklist add column if not exists checklist_date date;
alter table public.room_checklist add column if not exists area text;
alter table public.room_checklist add column if not exists utility text not null default '';
alter table public.room_checklist add column if not exists condition text not null default 'NORMAL';
alter table public.room_checklist add column if not exists notes text;
alter table public.room_checklist add column if not exists update_smarthome boolean not null default false;
alter table public.room_checklist add column if not exists sort_no integer;
alter table public.room_checklist add column if not exists created_at timestamptz not null default now();
alter table public.room_checklist add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_room_checklist_room on public.room_checklist(room);
create index if not exists idx_room_checklist_checklist_date on public.room_checklist(checklist_date);
create index if not exists idx_room_checklist_room_date on public.room_checklist(room, checklist_date);
