-- 구문 드릴 (별도 사이트 pif-drill) — 1차: 선생님용
-- Supabase 프로젝트: syntax-drill (kyboczqmdrjkubklajtb). 이미 적용됨.
create table public.staff (
  email text primary key check (email = lower(email)),
  role text not null default 'teacher' check (role in ('owner','teacher')),
  name text,
  created_at timestamptz not null default now()
);
create or replace function public.jwt_email() returns text language sql stable set search_path = '' as $$
  select lower(nullif(auth.jwt() ->> 'email', ''))
$$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.email = public.jwt_email())
$$;
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.email = public.jwt_email() and s.role = 'owner')
$$;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.is_owner() to authenticated, service_role;
alter table public.staff enable row level security;
create policy staff_select on public.staff for select to authenticated using (public.is_staff());
create policy staff_owner_insert on public.staff for insert to authenticated with check (public.is_owner());
create policy staff_owner_update on public.staff for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy staff_owner_delete on public.staff for delete to authenticated using (public.is_owner() and email <> public.jwt_email());
-- 처음 등록: insert into public.staff(email, role, name) values ('<원장 이메일>','owner','원장');

create table public.drill_categories (
  code text primary key check (char_length(code) between 1 and 20),
  title text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.drill_sentences (
  id uuid primary key default gen_random_uuid(),
  category text references public.drill_categories(code) on update cascade on delete set null,
  position int not null default 0,
  chunks jsonb not null default '[]'::jsonb check (jsonb_typeof(chunks) = 'array'),  -- [{en, ko}]
  text text not null default '',
  tags text[] not null default '{}',
  memo text,
  starred boolean not null default false,
  voice_en text, voice_ko text,
  audio_en text, audio_ko text,          -- 저장소 경로 (drill-audio 버킷)
  times_en jsonb, times_ko jsonb,        -- 의미구별 [시작초, 끝초]
  audio_key text,                        -- 음성을 만든 내용의 지문. null이면 문장이 바뀌어 다시 만들어야 함
  created_by text default public.jwt_email(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drill_sentences_cat on public.drill_sentences(category, position);

create table public.drill_lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  lesson_date date not null default (now() at time zone 'Asia/Seoul')::date,
  items uuid[] not null default '{}',
  created_by text default public.jwt_email(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drill_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.drill_categories enable row level security;
alter table public.drill_sentences enable row level security;
alter table public.drill_lessons enable row level security;
alter table public.drill_settings enable row level security;

create policy drill_categories_staff on public.drill_categories for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy drill_sentences_staff on public.drill_sentences for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy drill_lessons_staff on public.drill_lessons for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy drill_settings_staff on public.drill_settings for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.drill_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger drill_sentences_touch before update on public.drill_sentences for each row execute function public.drill_touch();
create trigger drill_lessons_touch before update on public.drill_lessons for each row execute function public.drill_touch();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drill-audio', 'drill-audio', false, 10485760, array['audio/mpeg']);
create policy drill_audio_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'drill-audio' and public.is_staff());

insert into public.drill_settings(key, value) values
 ('voices', '{"en":"XrExE9yKIg1WjnnlVkGX","ko":"H9ihk5yaEtJLXjhBgRaF"}'::jsonb);
