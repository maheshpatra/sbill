-- Local stand-in for Supabase Auth. Not applied on the hosted project.
-- Roles are cluster-wide. \gexec skips CREATE when a role already exists.
-- auth.uid() reads the GUC request.jwt.claim.sub (what PostgREST sets).

SELECT 'CREATE ROLE anon NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') \gexec

SELECT 'CREATE ROLE authenticated NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') \gexec

SELECT 'CREATE ROLE service_role NOLOGIN BYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') \gexec

SELECT 'CREATE ROLE supabase_auth_admin NOLOGIN BYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') \gexec

ALTER ROLE service_role BYPASSRLS;
ALTER ROLE supabase_auth_admin NOINHERIT;
ALTER ROLE supabase_auth_admin BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role, supabase_auth_admin;
