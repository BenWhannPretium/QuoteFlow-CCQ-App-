-- FB-05 (Notifications for hand-offs, returns and comments). Tracker: F-079, F-034. Data change only: no schema change.
--
-- The comment email window: comment emails wait this many minutes so several comments on one quote go
-- out as one email to each person. 0 sends each at once. Provisional; an Admin changes it in
-- Admin -> Settings (notifications). The notification types themselves are code (the catalogue), and the
-- outcomes' declared `notify` targets are unchanged: they are now delivered instead of only logged.

INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
VALUES (
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'comment_email_collapse_minutes',
  '10'::jsonb,
  'FB-05 (F-034): comment emails wait this many minutes so several comments on a quote go out as one email to each person ("3 new comments on CCQ-…"). 0 sends each comment at once. The in-app notification is never delayed. Provisional.',
  true
)
ON CONFLICT ("key") DO NOTHING;
