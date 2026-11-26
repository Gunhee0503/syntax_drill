-- 수업 4번 '독해적용': 문장이 나온 지문 + 5지선다(한글 보기). 문장 출처(src_key)로 묶어 같은 지문 문장끼리 함께 씀
create table if not exists public.drill_passages (
  id uuid primary key default gen_random_uuid(),
  src_key text not null unique,
  passage text not null,
  question text,
  choices text[] not null default '{}',
  answer int check (answer between 1 and 5),
  explanation text,
  created_by text default auth.jwt() ->> 'email',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.drill_passages enable row level security;
drop policy if exists drill_passages_staff on public.drill_passages;
create policy drill_passages_staff on public.drill_passages for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop trigger if exists drill_passages_touch on public.drill_passages;
create trigger drill_passages_touch before update on public.drill_passages for each row execute function public.drill_exam_touch();
