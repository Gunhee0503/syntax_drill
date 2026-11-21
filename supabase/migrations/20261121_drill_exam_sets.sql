-- 내신 세트: 학교·학년·연도·학기·시험 고정 칸 + 범위 메모. 문장은 여러 세트에 들어갈 수 있음
create table if not exists public.drill_schools (
  name text primary key,
  position int not null default 0,
  created_at timestamptz not null default now()
);
insert into public.drill_schools (name, position) values
  ('영동일고', 1), ('잠일고', 2), ('정신여고', 3), ('배명고', 4), ('잠신고', 5), ('잠실여고', 6)
on conflict (name) do nothing;

create table if not exists public.drill_exam_sets (
  id uuid primary key default gen_random_uuid(),
  school text not null references public.drill_schools(name) on update cascade,
  grade int not null check (grade between 1 and 3),
  year int not null check (year between 2000 and 2100),
  term int not null check (term in (1, 2)),
  exam text not null check (exam in ('mid', 'final')),
  scope text,
  class_code text,
  class_name text,
  published boolean not null default false,
  created_by text default auth.jwt() ->> 'email',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drill_exam_sets_school_idx on public.drill_exam_sets (school, year desc, grade, term, exam);
create index if not exists drill_exam_sets_class_idx on public.drill_exam_sets (class_code) where published;

-- 세트 안 문장 + 서술형 정보 (유형·핵심 포인트·출제 가능성)
create table if not exists public.drill_exam_items (
  set_id uuid not null references public.drill_exam_sets(id) on delete cascade,
  sentence_id uuid not null references public.drill_sentences(id) on delete cascade,
  position int not null default 0,
  types text[] not null default '{}',
  point text,
  level int check (level between 1 and 3),
  created_at timestamptz not null default now(),
  primary key (set_id, sentence_id)
);
create index if not exists drill_exam_items_sentence_idx on public.drill_exam_items (sentence_id);

-- 학생이 내신 세트를 들은 기록 (수업 기록과 따로)
create table if not exists public.drill_exam_listens (
  student_id uuid not null,
  set_id uuid not null references public.drill_exam_sets(id) on delete cascade,
  class_code text,
  opened_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  plays int not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  primary key (student_id, set_id)
);

alter table public.drill_schools enable row level security;
alter table public.drill_exam_sets enable row level security;
alter table public.drill_exam_items enable row level security;
alter table public.drill_exam_listens enable row level security;
create policy drill_schools_staff on public.drill_schools for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy drill_exam_sets_staff on public.drill_exam_sets for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy drill_exam_items_staff on public.drill_exam_items for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy drill_exam_listens_staff_read on public.drill_exam_listens for select to authenticated using (public.is_staff());

create or replace function public.drill_exam_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists drill_exam_sets_touch on public.drill_exam_sets;
create trigger drill_exam_sets_touch before update on public.drill_exam_sets for each row execute function public.drill_exam_touch();
