-- Note: the pgvector *package* is commonly called "pgvector", but the
-- Postgres extension it registers is named "vector". Must run before the
-- baseline migration, which declares claims.embedding as vector(384).
create extension if not exists vector;
create extension if not exists "uuid-ossp";
