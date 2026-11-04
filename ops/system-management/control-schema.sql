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
 payload text NOT NULL,public_payload text NOT NULL,idempotency_key text NOT NULL,intent_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(actor_id,idempotency_key));
CREATE INDEX IF NOT EXISTS system_management_jobs_actor ON system_management.jobs(actor_id,created_at DESC);
CREATE TABLE IF NOT EXISTS system_management.audit_events(
 id bigserial PRIMARY KEY,actor_id integer NOT NULL,host_id text NOT NULL,action text NOT NULL,outcome text NOT NULL,
 operation_id uuid,summary text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS system_management_audit_actor ON system_management.audit_events(actor_id,id DESC);
CREATE TABLE IF NOT EXISTS system_management.artifacts(id uuid PRIMARY KEY,actor_id integer NOT NULL,host_id text NOT NULL,kind text NOT NULL,operation_id uuid,path text NOT NULL,bytes bigint NOT NULL CHECK(bytes>=0),reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS system_management.reservations(job_id uuid PRIMARY KEY REFERENCES system_management.jobs(id),host_id text NOT NULL,root_id text NOT NULL,remaining_bytes bigint NOT NULL CHECK(remaining_bytes>=0),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS system_management.journal_usage(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),jobs bigint NOT NULL DEFAULT 0,events bigint NOT NULL DEFAULT 0,bytes bigint NOT NULL DEFAULT 0);
INSERT INTO system_management.journal_usage(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION system_management.enforce_journal_quota() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,system_management AS $$
DECLARE delta_jobs bigint:=0;delta_events bigint:=0;delta_bytes bigint:=0;usage system_management.journal_usage%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='jobs' THEN
  IF TG_OP<>'DELETE' THEN delta_bytes:=octet_length(NEW.payload)+octet_length(NEW.public_payload);IF octet_length(NEW.payload)>8388608 THEN RAISE EXCEPTION 'Management payload limit reached' USING ERRCODE='54000';END IF;END IF;
  IF TG_OP<>'INSERT' THEN delta_bytes:=delta_bytes-octet_length(OLD.payload)-octet_length(OLD.public_payload);END IF;
  delta_jobs:=CASE TG_OP WHEN 'INSERT' THEN 1 WHEN 'DELETE' THEN -1 ELSE 0 END;
 ELSE
  IF TG_OP<>'DELETE' THEN delta_bytes:=octet_length(NEW.summary);IF octet_length(NEW.summary)>262144 THEN RAISE EXCEPTION 'Management audit summary limit reached' USING ERRCODE='54000';END IF;END IF;
  IF TG_OP<>'INSERT' THEN delta_bytes:=delta_bytes-octet_length(OLD.summary);END IF;
  delta_events:=CASE TG_OP WHEN 'INSERT' THEN 1 WHEN 'DELETE' THEN -1 ELSE 0 END;
 END IF;
 IF delta_jobs<>0 OR delta_events<>0 OR delta_bytes<>0 THEN
  SELECT * INTO STRICT usage FROM system_management.journal_usage WHERE singleton FOR UPDATE;
  IF usage.jobs+delta_jobs>5000 OR usage.events+delta_events>100000 OR usage.bytes+delta_bytes>134217728 THEN RAISE EXCEPTION 'Management journal quota reached; retain uncertain outcomes and clean expired records' USING ERRCODE='54000';END IF;
  UPDATE system_management.journal_usage SET jobs=jobs+delta_jobs,events=events+delta_events,bytes=bytes+delta_bytes WHERE singleton;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION system_management.enforce_journal_quota() FROM PUBLIC;
DROP TRIGGER IF EXISTS management_jobs_quota ON system_management.jobs;
CREATE TRIGGER management_jobs_quota BEFORE INSERT OR UPDATE OR DELETE ON system_management.jobs FOR EACH ROW EXECUTE FUNCTION system_management.enforce_journal_quota();
DROP TRIGGER IF EXISTS management_events_quota ON system_management.audit_events;
CREATE TRIGGER management_events_quota BEFORE INSERT OR UPDATE OR DELETE ON system_management.audit_events FOR EACH ROW EXECUTE FUNCTION system_management.enforce_journal_quota();
REVOKE ALL ON ALL TABLES IN SCHEMA system_management FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA system_management FROM PUBLIC;
INSERT INTO system_management.schema_versions(version,checksum) VALUES(1,'system-management-v1') ON CONFLICT(version) DO NOTHING;
GRANT SELECT ON system_management.journal_usage TO omnilodge_system_authority,omnilodge_system_broker;
GRANT SELECT ON system_management.schema_versions TO omnilodge_system_authority,omnilodge_system_broker;
GRANT USAGE ON SCHEMA system_management TO omnilodge_system_authority,omnilodge_system_broker;
GRANT SELECT,INSERT,UPDATE,DELETE ON system_management.launch_grants,system_management.authority_sessions,system_management.auth_attempts TO omnilodge_system_authority;
GRANT SELECT,INSERT,UPDATE ON system_management.jobs,system_management.artifacts,system_management.reservations TO omnilodge_system_broker;
GRANT SELECT,INSERT ON system_management.audit_events TO omnilodge_system_broker;
GRANT DELETE ON system_management.artifacts TO omnilodge_system_broker;
GRANT USAGE ON SEQUENCE system_management.audit_events_id_seq TO omnilodge_system_broker;
GRANT SELECT,DELETE ON system_management.jobs,system_management.artifacts,system_management.audit_events,system_management.reservations TO omnilodge_system_authority;
COMMIT;
