Run `npm install`, then `npm test` for the student-flow regression suite.
Run `npm run build:css` after changing Tailwind classes.

Run `npm run test:layout` with Google Chrome installed for isolated headless browser checks.
These check both IELTS pages at five viewport widths (320–1440px), every part at the
largest text size, balanced columns, keyboard resizing, and wrapping of long questions,
options and Writing responses. External requests are blocked and local files are served
inside the tests. Screenshots are saved under the ignored `test-results/` directory.

The tests run the actual page scripts with local test JSON in jsdom. Database calls,
audio playback and browser dialogs are mocked; no student results are sent to Supabase.
Coverage includes start/resume/return, retakes, storage failures, submission retries,
scoring, expired timers, answer escaping, IELTS part navigation and listening limits.

Before deployment, check both IELTS pages in a real desktop and mobile browser:

- Passage and questions scroll independently; all parts and questions remain reachable.
- Resize the divider with a pointer or arrow keys; change the text size.
- Highlight passage text, flag questions, return home and resume the saved attempt.
- Play real audio twice, including returning during playback and reopening the test.
- Verify Writing copy/print/email and result submission using an authorized test account.

Submission retries are explicit because the existing database does not provide an
idempotency key. After a lost acknowledgement, a retry can create a duplicate result.
