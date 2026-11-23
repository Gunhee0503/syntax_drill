-- 하위 카테고리: 상위 카테고리 번호. 상위를 지우면 하위는 맨 위 단계로 올라옴
alter table public.drill_categories add column if not exists parent text references public.drill_categories(code) on update cascade on delete set null;
alter table public.drill_categories drop constraint if exists drill_categories_parent_not_self;
alter table public.drill_categories add constraint drill_categories_parent_not_self check (parent is null or parent <> code);
