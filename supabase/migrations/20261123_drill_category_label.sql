-- 하위 카테고리는 상위가 다르면 같은 번호(01, 02…)를 쓸 수 있게: 화면 표시용 label, 내부 키 code는 자동
alter table public.drill_categories add column if not exists label text;
alter table public.drill_categories drop constraint if exists drill_categories_code_check;
alter table public.drill_categories add constraint drill_categories_code_check check (char_length(code) between 1 and 120);
alter table public.drill_categories drop constraint if exists drill_categories_label_check;
alter table public.drill_categories add constraint drill_categories_label_check check (label is null or char_length(label) between 1 and 40);
