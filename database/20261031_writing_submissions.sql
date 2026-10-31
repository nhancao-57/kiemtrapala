-- Run in the Supabase SQL Editor BEFORE deploying the updated website.
-- Keeps existing results and the existing id type/default unchanged.
begin;

alter table public.test_results
  add column if not exists submission_id uuid,
  add column if not exists completed_at timestamptz,
  add column if not exists writing_answers jsonb not null default '[]'::jsonb;

-- NULL IDs on legacy rows are allowed. New clients send one UUID per attempt.
create unique index if not exists test_results_submission_id_key
  on public.test_results (submission_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.test_results'::regclass
      and conname = 'test_results_writing_answers_array'
  ) then
    alter table public.test_results
      add constraint test_results_writing_answers_array
      check (jsonb_typeof(writing_answers) = 'array');
  end if;
end $$;

comment on column public.test_results.submission_id is
  'Client-generated attempt UUID; a duplicate on its unique index confirms an earlier upload.';
comment on column public.test_results.completed_at is
  'Client-reported completion time; created_at remains the server upload time.';
comment on column public.test_results.writing_answers is
  'Task snapshots: question_id, display_number, section, prompt, context, instructions, image_url, answer, word_count. Writing is teacher-marked separately from score_correct/score_total.';

-- Existing INSERT policies still apply. Retries use plain INSERT and recognize
-- only this UUID index's duplicate error. No student SELECT or UPDATE is needed.
grant insert (submission_id, completed_at, writing_answers)
  on public.test_results to anon, authenticated;
grant select (submission_id, completed_at, writing_answers) on public.test_results to authenticated;

notify pgrst, 'reload schema';
commit;
