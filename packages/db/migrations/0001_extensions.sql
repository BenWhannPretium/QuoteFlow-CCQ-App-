-- B-03: extensions needed by the schema. On Azure Flexible Server, pg_trgm must be allow-listed
-- in the `azure.extensions` server parameter first (B-20).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
