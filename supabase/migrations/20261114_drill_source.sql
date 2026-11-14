-- 문장 출처 (편집 화면에서 칸을 나눠 고른 값 → 표기 통일). 이미 적용됨.
-- source: {type: mock|csat|ebs|text|etc, year, grade, month, book, unit, no, etc}
-- source_label: '2024 고1 3월 모의고사 29번' 같은 표시용 문자열 (검색에도 사용)
alter table public.drill_sentences add column source jsonb, add column source_label text;
create index drill_sentences_source_label on public.drill_sentences(source_label);
