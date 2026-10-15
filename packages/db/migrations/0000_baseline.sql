-- B-01 baseline: proves the migration pipeline end to end. No tables yet.
-- TODO(B-03): schema tables, RLS policies and the insert-only audit_event role arrive as new migrations.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
