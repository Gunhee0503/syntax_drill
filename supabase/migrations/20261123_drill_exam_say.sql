-- 재생 전 안내("1번, ○○ 29번 지문")에서 읽을 출처. 비우면 문장 출처를 그대로 읽음
alter table public.drill_exam_items add column if not exists say_src text;
