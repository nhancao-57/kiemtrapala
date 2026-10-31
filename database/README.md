# Writing uploads

Run `20261031_writing_submissions.sql` in the Supabase project's SQL Editor
**before deploying the updated site**. No extra table or Storage bucket is needed.
This migration is additive and can be rerun; it does not modify old answers,
scores, primary keys, or existing RLS policies.

| New column | Purpose |
| --- | --- |
| `submission_id uuid` (unique) | One ID per submitted attempt, persisted locally before upload. A retry does not insert another row or overwrite the original. Legacy rows can remain NULL. |
| `completed_at timestamptz` | When the student finished, even if upload was retried later. `created_at` remains the server upload time. |
| `writing_answers jsonb` (default `[]`) | Array of writing tasks, including full response, word count, question ID, section, prompt, instructions, context, and diagram path. Blank responses are included explicitly. |

`answers` still contains all original answers for compatibility. Writing is
excluded from automatic scores. The admin dashboard expands writing for teacher
review; this change does not add grading/feedback storage or a grading editor.
Other tests use the same submission ID/retry mechanism and store `[]` for writing.

## Permissions

The migration preserves your existing access rules. The current website submits
as `anon` (or `authenticated` if a Supabase session exists) and the admin dashboard
reads as `authenticated`. Existing INSERT grants/policies and the intended staff
SELECT policy must already permit those operations. Do not add public SELECT or
UPDATE access to make retries work, and do not put a service-role key in the site.

Inspect existing policies in the SQL Editor if uploads return permission errors:

```sql
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'test_results';
```

If INSERT is currently missing, this matches the site's existing public student
submission flow (run only after checking your intended access rules):

```sql
alter table public.test_results enable row level security;
grant insert (student_name, test_title, score_correct, score_total, answers,
              submission_id, completed_at, writing_answers)
  on public.test_results to anon, authenticated;
create policy "Students submit test results"
  on public.test_results for insert to anon, authenticated
  with check (true);
```

Keep the existing staff-only SELECT policy for the dashboard. Signing in alone
does not establish a staff role if your project also allows student accounts.
If `id` uses a sequence and existing inserts already work, its grants need no
change. The schema migration does not broaden who can read results.

## After applying SQL

1. Deploy the updated files. Submit an IELTS Mindset 1.1 test with a multiline
   essay. Confirm the result screen reports successful storage.
2. Check the new row in `test_results`: the essay appears in both `answers["61"]`
   and `writing_answers[0].answer`, and the automatic score is out of 60.
3. Open the admin dashboard and expand “Xem bài Writing”; check the prompt,
   diagram, word count, and complete response.
4. Test a failed upload, reload, and retry. The attempt keeps its UUID and payload.
   If the first request reached the server, the retry leaves exactly one row.
5. Submit a non-writing test to verify its usual score and empty writing array.

Old IELTS Mindset 1.1 rows can still show their essay from `answers["61"]`; their
original prompt was not saved, so the dashboard labels that limitation. Old
successful submissions are not automatically re-uploaded. An old failed/pending
attempt from before this change has no deduplication ID: check for an existing
server row before its first retry after upgrading.

Local backup/download and retry remain available when uploading fails. If the
browser cannot save local storage, keep the page open and download the backup.
Scores, timestamps, and word counts are client-reported, as in the existing system.

Retries use a plain INSERT and recognize only PostgreSQL error `23505` naming
`test_results_submission_id_key` as confirmation of an earlier upload. Other
unique-key failures remain errors. This preserves insert-only access under
[Supabase RLS policies](https://supabase.com/docs/guides/database/postgres/row-level-security).
