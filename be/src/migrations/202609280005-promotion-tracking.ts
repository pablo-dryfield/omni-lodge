import { DataTypes, type QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const ROUTE_PLANS = 'promotion_route_plans';
const ROUTE_VERSIONS = 'promotion_route_versions';
const ROUTE_CHECKPOINTS = 'promotion_route_checkpoints';
const TEAM_ASSIGNMENTS = 'promotion_team_assignments';
const SESSIONS = 'promotion_sessions';
const PARTICIPANTS = 'promotion_session_participants';
const SAMPLES = 'promotion_location_samples';
const VISITS = 'promotion_checkpoint_visits';
const CHALLENGES = 'promotion_copresence_challenges';
const RESPONSES = 'promotion_copresence_responses';
const INCIDENTS = 'promotion_incidents';
const OVERRIDES = 'promotion_manager_overrides';

const timestamps = {
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
};

const nullableUserRef = {
  type: DataTypes.INTEGER,
  allowNull: true,
  references: { model: 'users', key: 'id' },
  onUpdate: 'CASCADE',
  onDelete: 'SET NULL',
};

const requiredUserRef = {
  type: DataTypes.INTEGER,
  allowNull: false,
  references: { model: 'users', key: 'id' },
  onUpdate: 'CASCADE',
  onDelete: 'RESTRICT',
};

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.createTable(ROUTE_PLANS, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(160), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'active' },
      created_by: nullableUserRef,
      updated_by: nullableUserRef,
      ...timestamps,
    }, { transaction });
    await context.addIndex(ROUTE_PLANS, ['status', 'name'], { name: 'promo_route_plans_status_name_idx', transaction });

    await context.createTable(ROUTE_VERSIONS, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      route_plan_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: ROUTE_PLANS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      version_number: { type: DataTypes.INTEGER, allowNull: false },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'draft' },
      route_name: { type: DataTypes.STRING(160), allowNull: false },
      default_hostel_venue_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'venues', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      hostel_name: { type: DataTypes.STRING(160), allowNull: true },
      start_label: { type: DataTypes.STRING(160), allowNull: false },
      start_latitude: { type: DataTypes.DOUBLE, allowNull: false },
      start_longitude: { type: DataTypes.DOUBLE, allowNull: false },
      start_radius_meters: { type: DataTypes.DOUBLE, allowNull: false },
      finish_label: { type: DataTypes.STRING(160), allowNull: false },
      finish_latitude: { type: DataTypes.DOUBLE, allowNull: false },
      finish_longitude: { type: DataTypes.DOUBLE, allowNull: false },
      finish_radius_meters: { type: DataTypes.DOUBLE, allowNull: false },
      street_polyline: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      hostel_polyline: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      policy_json: { type: DataTypes.JSONB, allowNull: false },
      published_at: { type: DataTypes.DATE, allowNull: true },
      created_by: nullableUserRef,
      published_by: nullableUserRef,
      ...timestamps,
    }, { transaction });
    await context.addIndex(ROUTE_VERSIONS, ['route_plan_id', 'version_number'], {
      name: 'promo_route_versions_plan_ver_key',
      unique: true,
      transaction,
    });
    await context.addIndex(ROUTE_VERSIONS, ['status', 'published_at'], {
      name: 'promo_route_versions_status_pub_idx',
      transaction,
    });

    await context.createTable(ROUTE_CHECKPOINTS, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      route_version_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: ROUTE_VERSIONS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      phase: { type: DataTypes.STRING(16), allowNull: false },
      sequence: { type: DataTypes.INTEGER, allowNull: false },
      label: { type: DataTypes.STRING(160), allowNull: false },
      instruction: { type: DataTypes.TEXT, allowNull: false },
      latitude: { type: DataTypes.DOUBLE, allowNull: false },
      longitude: { type: DataTypes.DOUBLE, allowNull: false },
      radius_meters: { type: DataTypes.DOUBLE, allowNull: false },
      required_dwell_seconds: { type: DataTypes.INTEGER, allowNull: false },
      ...timestamps,
    }, { transaction });
    await context.addIndex(ROUTE_CHECKPOINTS, ['route_version_id', 'phase', 'sequence'], {
      name: 'promo_checkpoints_version_phase_seq_key',
      unique: true,
      transaction,
    });

    await context.createTable(TEAM_ASSIGNMENTS, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      shift_instance_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'shift_instances', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      route_version_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: ROUTE_VERSIONS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      hostel_venue_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'venues', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      hostel_label: { type: DataTypes.STRING(160), allowNull: true },
      team_key: { type: DataTypes.STRING(120), allowNull: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
      created_by: nullableUserRef,
      ...timestamps,
    }, { transaction });
    await context.addIndex(TEAM_ASSIGNMENTS, ['shift_instance_id', 'team_key'], {
      name: 'promo_team_assignments_shift_team_key',
      unique: true,
      transaction,
    });
    await context.addIndex(TEAM_ASSIGNMENTS, ['route_version_id'], {
      name: 'promo_team_assignments_route_idx',
      transaction,
    });

    await context.createTable(SESSIONS, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      shift_instance_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'shift_instances', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      assignment_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'shift_assignments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      team_assignment_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: TEAM_ASSIGNMENTS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      route_version_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: ROUTE_VERSIONS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      started_by: requiredUserRef,
      lifecycle: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'STREET_ACTIVE' },
      verification_quality: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'VERIFIED' },
      session_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      idempotency_key: { type: DataTypes.STRING(160), allowNull: false },
      first_accepted_proof_at: { type: DataTypes.DATE, allowNull: true },
      street_started_at: { type: DataTypes.DATE, allowNull: true },
      street_completed_at: { type: DataTypes.DATE, allowNull: true },
      hostel_started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      aborted_at: { type: DataTypes.DATE, allowNull: true },
      actual_street_duration_seconds: { type: DataTypes.INTEGER, allowNull: true },
      actual_hostel_duration_seconds: { type: DataTypes.INTEGER, allowNull: true },
      quality_flags: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      server_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ...timestamps,
    }, { transaction });
    await context.addIndex(SESSIONS, ['idempotency_key'], {
      name: 'promo_sessions_start_idem_key',
      unique: true,
      transaction,
    });
    await context.addIndex(SESSIONS, ['shift_instance_id', 'lifecycle'], {
      name: 'promo_sessions_shift_lifecycle_idx',
      transaction,
    });
    await context.sequelize.query(
      `CREATE UNIQUE INDEX promo_sessions_active_assignment_key
       ON ${SESSIONS} (assignment_id)
       WHERE lifecycle IN ('STREET_ACTIVE','HOSTEL_ACTIVE')`,
      { transaction },
    );
    await context.sequelize.query(
      `CREATE UNIQUE INDEX promo_sessions_active_team_key
       ON ${SESSIONS} (team_assignment_id)
       WHERE lifecycle IN ('STREET_ACTIVE','HOSTEL_ACTIVE')`,
      { transaction },
    );

    await context.createTable(PARTICIPANTS, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      session_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: SESSIONS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      shift_assignment_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'shift_assignments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      user_id: requiredUserRef,
      proof_status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'pending' },
      verification_quality: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'REVIEW_REQUIRED' },
      proof_received_at: { type: DataTypes.DATE, allowNull: true },
      last_heartbeat_at: { type: DataTypes.DATE, allowNull: true },
      last_sequence: { type: DataTypes.BIGINT, allowNull: true },
      proof_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ...timestamps,
    }, { transaction });
    await context.addIndex(PARTICIPANTS, ['session_id', 'user_id'], {
      name: 'promo_participants_session_user_key',
      unique: true,
      transaction,
    });
    await context.addIndex(PARTICIPANTS, ['shift_assignment_id'], {
      name: 'promo_participants_assignment_idx',
      transaction,
    });

    await context.createTable(SAMPLES, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      session_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: SESSIONS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      participant_session_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: PARTICIPANTS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      user_id: requiredUserRef,
      event_id: { type: DataTypes.UUID, allowNull: false },
      sequence: { type: DataTypes.BIGINT, allowNull: false },
      captured_at: { type: DataTypes.DATE, allowNull: false },
      elapsed_realtime_nanos: { type: DataTypes.STRING(32), allowNull: false },
      boot_id: { type: DataTypes.STRING(128), allowNull: false },
      latitude: { type: DataTypes.DOUBLE, allowNull: false },
      longitude: { type: DataTypes.DOUBLE, allowNull: false },
      horizontal_accuracy_meters: { type: DataTypes.DOUBLE, allowNull: false },
      speed_meters_per_second: { type: DataTypes.DOUBLE, allowNull: true },
      bearing_degrees: { type: DataTypes.DOUBLE, allowNull: true },
      phase: { type: DataTypes.STRING(16), allowNull: false },
      mock_location_signal: { type: DataTypes.BOOLEAN, allowNull: true },
      review_flags: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      server_received_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      ...timestamps,
    }, { transaction });
    await context.addIndex(SAMPLES, ['session_id', 'event_id'], {
      name: 'promo_samples_session_event_key',
      unique: true,
      transaction,
    });
    await context.addIndex(SAMPLES, ['session_id', 'user_id', 'sequence'], {
      name: 'promo_samples_session_user_seq_key',
      unique: true,
      transaction,
    });
    await context.addIndex(SAMPLES, ['session_id', 'captured_at'], {
      name: 'promo_samples_session_time_idx',
      transaction,
    });

    await context.createTable(VISITS, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      session_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: SESSIONS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      route_checkpoint_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: ROUTE_CHECKPOINTS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      phase: { type: DataTypes.STRING(16), allowNull: false },
      sequence: { type: DataTypes.INTEGER, allowNull: false },
      accepted_at: { type: DataTypes.DATE, allowNull: false },
      dwell_seconds: { type: DataTypes.INTEGER, allowNull: false },
      idempotency_key: { type: DataTypes.STRING(160), allowNull: false },
      evidence_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ...timestamps,
    }, { transaction });
    await context.addIndex(VISITS, ['session_id', 'route_checkpoint_id'], {
      name: 'promo_visits_session_checkpoint_key',
      unique: true,
      transaction,
    });
    await context.addIndex(VISITS, ['idempotency_key'], {
      name: 'promo_visits_idem_key',
      unique: true,
      transaction,
    });

    await context.createTable(CHALLENGES, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      team_assignment_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: TEAM_ASSIGNMENTS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      session_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: SESSIONS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      issued_by: requiredUserRef,
      nonce_hash: { type: DataTypes.STRING(128), allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ...timestamps,
    }, { transaction });
    await context.addIndex(CHALLENGES, ['nonce_hash'], {
      name: 'promo_copresence_nonce_key',
      unique: true,
      transaction,
    });
    await context.addIndex(CHALLENGES, ['team_assignment_id', 'status', 'expires_at'], {
      name: 'promo_copresence_team_status_idx',
      transaction,
    });

    await context.createTable(RESPONSES, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      challenge_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: CHALLENGES, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      shift_assignment_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'shift_assignments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      user_id: requiredUserRef,
      response_kind: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'own_device' },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'review_required' },
      verification_quality: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'REVIEW_REQUIRED' },
      responded_at: { type: DataTypes.DATE, allowNull: false },
      latitude: { type: DataTypes.DOUBLE, allowNull: true },
      longitude: { type: DataTypes.DOUBLE, allowNull: true },
      horizontal_accuracy_meters: { type: DataTypes.DOUBLE, allowNull: true },
      distance_from_start_meters: { type: DataTypes.DOUBLE, allowNull: true },
      rejection_reason: { type: DataTypes.TEXT, allowNull: true },
      photo_evidence_ref: { type: DataTypes.STRING(255), allowNull: true },
      proof_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ...timestamps,
    }, { transaction });
    await context.addIndex(RESPONSES, ['challenge_id', 'user_id'], {
      name: 'promo_copresence_response_user_key',
      unique: true,
      transaction,
    });

    await context.createTable(INCIDENTS, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      session_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: SESSIONS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      participant_session_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: PARTICIPANTS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      reported_by: requiredUserRef,
      category: { type: DataTypes.STRING(48), allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'open' },
      evidence_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ...timestamps,
    }, { transaction });
    await context.addIndex(INCIDENTS, ['session_id', 'created_at'], {
      name: 'promo_incidents_session_time_idx',
      transaction,
    });

    await context.createTable(OVERRIDES, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      session_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: SESSIONS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      actor_id: requiredUserRef,
      override_type: { type: DataTypes.STRING(64), allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      before_json: { type: DataTypes.JSONB, allowNull: false },
      after_json: { type: DataTypes.JSONB, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });
    await context.addIndex(OVERRIDES, ['session_id', 'created_at'], {
      name: 'promo_overrides_session_time_idx',
      transaction,
    });

    await context.sequelize.query(`
      ALTER TABLE ${ROUTE_PLANS}
        ADD CONSTRAINT promo_route_plans_status_chk CHECK (status IN ('active','archived'));
      ALTER TABLE ${ROUTE_VERSIONS}
        ADD CONSTRAINT promo_route_versions_status_chk CHECK (status IN ('draft','published','retired')),
        ADD CONSTRAINT promo_route_versions_start_lat_chk CHECK (start_latitude BETWEEN -90 AND 90),
        ADD CONSTRAINT promo_route_versions_start_lng_chk CHECK (start_longitude BETWEEN -180 AND 180),
        ADD CONSTRAINT promo_route_versions_finish_lat_chk CHECK (finish_latitude BETWEEN -90 AND 90),
        ADD CONSTRAINT promo_route_versions_finish_lng_chk CHECK (finish_longitude BETWEEN -180 AND 180),
        ADD CONSTRAINT promo_route_versions_radii_chk CHECK (start_radius_meters > 0 AND finish_radius_meters > 0);
      ALTER TABLE ${ROUTE_CHECKPOINTS}
        ADD CONSTRAINT promo_checkpoints_phase_chk CHECK (phase IN ('street','hostel')),
        ADD CONSTRAINT promo_checkpoints_lat_chk CHECK (latitude BETWEEN -90 AND 90),
        ADD CONSTRAINT promo_checkpoints_lng_chk CHECK (longitude BETWEEN -180 AND 180),
        ADD CONSTRAINT promo_checkpoints_radius_chk CHECK (radius_meters > 0 AND required_dwell_seconds >= 0);
      ALTER TABLE ${SESSIONS}
        ADD CONSTRAINT promo_sessions_lifecycle_chk CHECK (lifecycle IN ('NOT_STARTED','STREET_ACTIVE','HOSTEL_ACTIVE','COMPLETED','ABORTED')),
        ADD CONSTRAINT promo_sessions_quality_chk CHECK (verification_quality IN ('VERIFIED','DEGRADED','REVIEW_REQUIRED')),
        ADD CONSTRAINT promo_sessions_version_chk CHECK (session_version >= 1);
      ALTER TABLE ${PARTICIPANTS}
        ADD CONSTRAINT promo_participants_quality_chk CHECK (verification_quality IN ('VERIFIED','DEGRADED','REVIEW_REQUIRED'));
      ALTER TABLE ${SAMPLES}
        ADD CONSTRAINT promo_samples_phase_chk CHECK (phase IN ('street','hostel')),
        ADD CONSTRAINT promo_samples_lat_chk CHECK (latitude BETWEEN -90 AND 90),
        ADD CONSTRAINT promo_samples_lng_chk CHECK (longitude BETWEEN -180 AND 180),
        ADD CONSTRAINT promo_samples_accuracy_chk CHECK (horizontal_accuracy_meters > 0);
      ALTER TABLE ${VISITS}
        ADD CONSTRAINT promo_visits_phase_chk CHECK (phase IN ('street','hostel'));
      ALTER TABLE ${CHALLENGES}
        ADD CONSTRAINT promo_copresence_status_chk CHECK (status IN ('active','used','expired','revoked'));
      ALTER TABLE ${RESPONSES}
        ADD CONSTRAINT promo_copresence_resp_status_chk CHECK (status IN ('accepted','rejected','review_required')),
        ADD CONSTRAINT promo_copresence_resp_quality_chk CHECK (verification_quality IN ('VERIFIED','DEGRADED','REVIEW_REQUIRED'));
    `, { transaction });
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.dropTable(OVERRIDES, { transaction });
    await context.dropTable(INCIDENTS, { transaction });
    await context.dropTable(RESPONSES, { transaction });
    await context.dropTable(CHALLENGES, { transaction });
    await context.dropTable(VISITS, { transaction });
    await context.dropTable(SAMPLES, { transaction });
    await context.dropTable(PARTICIPANTS, { transaction });
    await context.dropTable(SESSIONS, { transaction });
    await context.dropTable(TEAM_ASSIGNMENTS, { transaction });
    await context.dropTable(ROUTE_CHECKPOINTS, { transaction });
    await context.dropTable(ROUTE_VERSIONS, { transaction });
    await context.dropTable(ROUTE_PLANS, { transaction });
  });
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [
    routePlans,
    routeVersions,
    checkpoints,
    teamAssignments,
    sessions,
    participants,
    samples,
    visits,
    challenges,
    responses,
    incidents,
    overrides,
  ] = await Promise.all([
    context.describeTable(ROUTE_PLANS),
    context.describeTable(ROUTE_VERSIONS),
    context.describeTable(ROUTE_CHECKPOINTS),
    context.describeTable(TEAM_ASSIGNMENTS),
    context.describeTable(SESSIONS),
    context.describeTable(PARTICIPANTS),
    context.describeTable(SAMPLES),
    context.describeTable(VISITS),
    context.describeTable(CHALLENGES),
    context.describeTable(RESPONSES),
    context.describeTable(INCIDENTS),
    context.describeTable(OVERRIDES),
  ]);
  const details = {
    routePlans: Boolean(routePlans.name && routePlans.status),
    routeVersions: Boolean(routeVersions.route_plan_id && routeVersions.policy_json && routeVersions.start_latitude && routeVersions.finish_latitude),
    checkpoints: Boolean(checkpoints.route_version_id && checkpoints.phase && checkpoints.sequence),
    teamAssignments: Boolean(teamAssignments.shift_instance_id && teamAssignments.route_version_id && teamAssignments.team_key),
    sessions: Boolean(sessions.route_version_id && sessions.lifecycle && sessions.session_version && sessions.idempotency_key),
    participants: Boolean(participants.session_id && participants.user_id && participants.proof_status),
    samples: Boolean(samples.event_id && samples.sequence && samples.elapsed_realtime_nanos && samples.mock_location_signal),
    visits: Boolean(visits.route_checkpoint_id && visits.idempotency_key),
    challenges: Boolean(challenges.nonce_hash && challenges.expires_at),
    responses: Boolean(responses.challenge_id && responses.response_kind && responses.verification_quality),
    incidents: Boolean(incidents.session_id && incidents.reason),
    overrides: Boolean(overrides.actor_id && overrides.reason && overrides.before_json && overrides.after_json),
  };
  return { ok: Object.values(details).every(Boolean), details };
}
