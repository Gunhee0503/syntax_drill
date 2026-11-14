-- 문장 작성자(강사): 선생님 계정 이름을 그대로 저장, 작성자로 걸러 보기·검색
alter table public.drill_sentences add column if not exists author text;
update public.drill_sentences s set author = st.name from public.staff st where s.author is null and lower(st.email) = lower(s.created_by);
create index if not exists drill_sentences_author_idx on public.drill_sentences (author);
