-- 같은 학교·시험 안에서도 범위별로 세트를 나눌 수 있게: 세트 이름(예: 9월 모의고사, 교과서 3~4과)
alter table public.drill_exam_sets add column if not exists name text;
