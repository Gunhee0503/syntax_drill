-- ECHO (학생 다시듣기). 이미 적용됨.
alter table public.drill_lessons add column class_code text, add column class_name text, add column published boolean not null default false;
create index drill_lessons_class on public.drill_lessons(class_code, published, lesson_date desc);
create table public.drill_listens (
  student_id uuid not null, lesson_id uuid not null references public.drill_lessons(id) on delete cascade,
  class_code text, opened_at timestamptz not null default now(), last_at timestamptz not null default now(),
  plays int not null default 0, completed boolean not null default false, completed_at timestamptz,
  primary key (student_id, lesson_id));
alter table public.drill_listens enable row level security;
create policy drill_listens_staff_read on public.drill_listens for select to authenticated using (public.is_staff());
create table public.drill_student_stars (student_id uuid not null, sentence_id uuid not null references public.drill_sentences(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (student_id, sentence_id));
alter table public.drill_student_stars enable row level security;
create policy drill_student_stars_staff_read on public.drill_student_stars for select to authenticated using (public.is_staff());
-- 허브(beacon-syntax) 쪽에는 public.echo_bridge_classes(p_key) 함수가 있음 (반 코드·이름만 반환, 키 확인).
