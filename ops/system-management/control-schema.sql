BEGIN;
CREATE SCHEMA IF NOT EXISTS system_management;
REVOKE ALL ON SCHEMA system_management FROM PUBLIC;
CREATE TABLE IF NOT EXISTS system_management.schema_versions(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS system_management.launch_grants(
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),actor_id integer NOT NULL,parent_jti uuid NOT NULL,
 policy_hash text NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz);
CREATE TABLE IF NOT EXISTS system_management.authority_sessions(
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),actor_id integer NOT NULL,parent_jti uuid NOT NULL,
 policy_hash text NOT NULL,expires_at timestamptz NOT NULL,step_up_until timestamptz,revoked_at timestamptz,last_activity_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS system_management_parent_session ON system_management.authority_sessions(parent_jti);
CREATE TABLE IF NOT EXISTS system_management.auth_attempts(actor_id integer NOT NULL,window_start timestamptz NOT NULL,attempts integer NOT NULL,PRIMARY KEY(actor_id,window_start));
CREATE TABLE IF NOT EXISTS system_management.jobs(
 id uuid PRIMARY KEY,actor_id integer NOT NULL,host_id text NOT NULL,kind text NOT NULL,state text NOT NULL,
 payload text NOT NULL,idempotency_key text NOT NULL,intent_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(actor_id,idempotency_key));
CREATE INDEX IF NOT EXISTS system_management_jobs_actor ON system_management.jobs(actor_id,created_at DESC);
CREATE TABLE IF NOT EXISTS system_management.audit_events(
 id bigserial PRIMARY KEY,actor_id integer NOT NULL,host_id text NOT NULL,action text NOT NULL,outcome text NOT NULL,
 operation_id uuid,summary text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS system_management_audit_actor ON system_management.audit_events(actor_id,id DESC);
CREATE TABLE IF NOT EXISTS system_management.artifacts(id uuid PRIMARY KEY,actor_id integer NOT NULL,host_id text NOT NULL,kind text NOT NULL,operation_id uuid,path text NOT NULL,bytes bigint NOT NULL CHECK(bytes>=0),reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS system_management.reservations(job_id uuid PRIMARY KEY REFERENCES system_management.jobs(id),host_id text NOT NULL,root_id text NOT NULL,remaining_bytes bigint NOT NULL CHECK(remaining_bytes>=0),expires_at timestamptz NOT NULL);
REVOKE ALL ON ALL TABLES IN SCHEMA system_management FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA system_management FROM PUBLIC;
INSERT INTO system_management.schema_versions(version,checksum) VALUES(1,'system-management-v1') ON CONFLICT(version) DO NOTHING;
GRANT SELECT ON system_management.schema_versions TO omnilodge_system_authority,omnilodge_system_broker;
GRANT USAGE ON SCHEMA system_management TO omnilodge_system_authority,omnilodge_system_broker;
GRANT SELECT,INSERT,UPDATE,DELETE ON system_management.launch_grants,system_management.authority_sessions,system_management.auth_attempts TO omnilodge_system_authority;
GRANT SELECT,INSERT,UPDATE ON system_management.jobs,system_management.artifacts,system_management.reservations TO omnilodge_system_broker;
GRANT SELECT,INSERT ON system_management.audit_events TO omnilodge_system_broker;
GRANT DELETE ON system_management.artifacts TO omnilodge_system_broker;
GRANT USAGE ON SEQUENCE system_management.audit_events_id_seq TO omnilodge_system_broker;
GRANT SELECT,DELETE ON system_management.jobs,system_management.artifacts,system_management.audit_events,system_management.reservations TO omnilodge_system_authority;
COMMIT;
