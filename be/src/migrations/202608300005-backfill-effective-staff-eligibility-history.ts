import { QueryTypes, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

type ObservationDateRow = {
  observation_date: string | null;
};

type ObservedUserTypeRow = {
  user_id: number;
  user_type_id: number;
  effective_start: string;
};

type UserTypeIdRow = {
  id: number;
};

type UserTypeAuditRow = {
  user_id: number;
  event_date: string;
  previous_user_type_id: number | string | null;
  next_user_type_id: number | string | null;
  actor_id: number | null;
  audit_id: string;
};

type RoleEvidenceRow = {
  user_id: number;
  shift_role_id: number;
  evidence_date: string;
};

const AUDIT_BACKFILL_SOURCE = 'migration_audit_transition_backfill_v1';
const ROLE_EVIDENCE_BACKFILL_SOURCE = 'migration_role_work_evidence_backfill_v1';

const previousDate = (value: string): string => {
  const parsed = new Date(`${value}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
};

const nextDate = (value: string): string => {
  const parsed = new Date(`${value}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
};

const normalizePositiveId = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const isIsoDate = (value: unknown): value is string => (
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
);

const buildContiguousRanges = (dates: string[]): Array<{ start: string; end: string }> => {
  const sorted = Array.from(new Set(dates.filter(isIsoDate))).sort();
  const ranges: Array<{ start: string; end: string }> = [];
  sorted.forEach((date) => {
    const current = ranges.at(-1);
    if (!current || nextDate(current.end) !== date) {
      ranges.push({ start: date, end: date });
      return;
    }
    current.end = date;
  });
  return ranges;
};

/**
 * Backfill only facts that have a dated, immutable source.
 *
 * Migration 004 deliberately records mutable projections from its observation
 * date forward. Those rows remain untouched here so rollback is lossless and a
 * current value is never guessed backward to a user's/profile's creation date.
 */
export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    const [observation] = await context.sequelize.query<ObservationDateRow>(
      `SELECT MIN(effective_start)::text AS observation_date
         FROM (
           SELECT effective_start
             FROM user_type_membership_periods
            WHERE source = 'migration_current_state'
           UNION ALL
           SELECT effective_start
             FROM user_shift_role_membership_periods
            WHERE source = 'migration_current_state'
           UNION ALL
           SELECT effective_start
             FROM staff_profile_type_periods
            WHERE source = 'migration_current_state'
         ) AS observed_current_state`,
      { type: QueryTypes.SELECT, transaction },
    );
    const observationDate = isIsoDate(observation?.observation_date)
      ? observation.observation_date
      : null;

    const observedUserTypes = await context.sequelize.query<ObservedUserTypeRow>(
      `SELECT user_id,
              user_type_id,
              effective_start::text AS effective_start
         FROM user_type_membership_periods
        WHERE source = 'migration_current_state'
          AND effective_end IS NULL
        ORDER BY user_id`,
      { type: QueryTypes.SELECT, transaction },
    );
    const validUserTypeRows = await context.sequelize.query<UserTypeIdRow>(
      `SELECT id
         FROM "userTypes"
        ORDER BY id`,
      { type: QueryTypes.SELECT, transaction },
    );
    const auditRows = await context.sequelize.query<UserTypeAuditRow>(
      `SELECT u.id AS user_id,
              (audit.created_at AT TIME ZONE 'Europe/Warsaw')::date::text AS event_date,
              CASE
                WHEN COALESCE(audit.meta_json #>> '{previous,userTypeId}', '') ~ '^[1-9][0-9]*$'
                 AND length(COALESCE(audit.meta_json #>> '{previous,userTypeId}', '')) <= 10
                  THEN (audit.meta_json #>> '{previous,userTypeId}')::bigint
                ELSE NULL
              END AS previous_user_type_id,
              CASE
                WHEN COALESCE(audit.meta_json #>> '{next,userTypeId}', '') ~ '^[1-9][0-9]*$'
                 AND length(COALESCE(audit.meta_json #>> '{next,userTypeId}', '')) <= 10
                  THEN (audit.meta_json #>> '{next,userTypeId}')::bigint
                ELSE NULL
              END AS next_user_type_id,
              audit.actor_id,
              audit.id::text AS audit_id
         FROM audit_logs AS audit
         JOIN users AS u ON u.id::text = audit.entity_id
        WHERE audit.entity = 'user'
          AND audit.action = 'user.role_changed'
        ORDER BY u.id, audit.created_at, audit.id`,
      { type: QueryTypes.SELECT, transaction },
    );

    const validUserTypeIds = new Set(
      validUserTypeRows
        .map((row) => normalizePositiveId(row.id))
        .filter((id): id is number => id !== null),
    );
    const observedUserTypeByUser = new Map<number, ObservedUserTypeRow>();
    observedUserTypes.forEach((row) => {
      const userId = normalizePositiveId(row.user_id);
      const userTypeId = normalizePositiveId(row.user_type_id);
      if (userId && userTypeId && isIsoDate(row.effective_start)) {
        observedUserTypeByUser.set(userId, {
          user_id: userId,
          user_type_id: userTypeId,
          effective_start: row.effective_start,
        });
      }
    });

    const auditsByUser = new Map<number, UserTypeAuditRow[]>();
    auditRows.forEach((row) => {
      const userId = normalizePositiveId(row.user_id);
      if (!userId || !isIsoDate(row.event_date)) {
        return;
      }
      const bucket = auditsByUser.get(userId) ?? [];
      bucket.push(row);
      auditsByUser.set(userId, bucket);
    });

    const backfillTimestamp = new Date();
    const userTypePeriods: Array<Record<string, unknown>> = [];
    auditsByUser.forEach((rawEvents, userId) => {
      const observed = observedUserTypeByUser.get(userId);
      if (!observed) {
        return;
      }

      // Date-only periods cannot represent two transitions on the same day.
      // The last audit of that day is the state observable at day end.
      const eventByDate = new Map<string, UserTypeAuditRow>();
      rawEvents.forEach((event) => eventByDate.set(event.event_date, event));
      const events = Array.from(eventByDate.values())
        // An audit on the observation date is retained as the boundary for the
        // preceding period, but never becomes a second row on that date.
        .filter((event) => event.event_date <= observed.effective_start)
        .sort((left, right) => left.event_date.localeCompare(right.event_date));

      events.forEach((event, index) => {
        if (event.event_date >= observed.effective_start) {
          return;
        }
        const nextUserTypeId = normalizePositiveId(event.next_user_type_id);
        if (!nextUserTypeId || !validUserTypeIds.has(nextUserTypeId)) {
          return;
        }

        const nextEvent = events[index + 1] ?? null;
        const nextPreviousTypeId = normalizePositiveId(nextEvent?.previous_user_type_id);
        const boundaryIsConsistent = nextEvent
          ? nextPreviousTypeId === nextUserTypeId
          : observed.user_type_id === nextUserTypeId;
        const boundedEnd = nextEvent
          ? previousDate(nextEvent.event_date)
          : previousDate(observed.effective_start);
        // A broken/missing audit chain proves the transition date itself, but
        // not the unobserved days through the following boundary.
        const effectiveEnd = boundaryIsConsistent ? boundedEnd : event.event_date;
        if (effectiveEnd < event.event_date) {
          return;
        }

        userTypePeriods.push({
          user_id: userId,
          user_type_id: nextUserTypeId,
          effective_start: event.event_date,
          effective_end: effectiveEnd,
          created_by: normalizePositiveId(event.actor_id),
          ended_by: boundaryIsConsistent ? normalizePositiveId(nextEvent?.actor_id) : null,
          change_reason: boundaryIsConsistent
            ? 'Backfilled from a consistent user.role_changed audit transition.'
            : 'Backfilled only on the audited transition date because the later audit chain is incomplete.',
          source: AUDIT_BACKFILL_SOURCE,
          metadata: JSON.stringify({
            confidence: boundaryIsConsistent ? 'audit_chain' : 'audit_transition_date_only',
            startingAuditId: event.audit_id,
            endingAuditId: nextEvent?.audit_id ?? null,
            migration: '202608300005',
          }),
          created_at: backfillTimestamp,
          updated_at: backfillTimestamp,
        });
      });
    });
    if (userTypePeriods.length > 0) {
      await context.bulkInsert(
        'user_type_membership_periods',
        userTypePeriods,
        { transaction },
      );
    }

    const roleEvidence = observationDate
      ? await context.sequelize.query<RoleEvidenceRow>(
        `SELECT sa.user_id,
                sa.shift_role_id,
                si.date::text AS evidence_date
           FROM shift_assignments AS sa
           JOIN shift_instances AS si ON si.id = sa.shift_instance_id
          WHERE sa.shift_role_id IS NOT NULL
            AND si.date < :observationDate
         UNION
         SELECT report.leader_id AS user_id,
                role.id AS shift_role_id,
                report.activity_date::text AS evidence_date
           FROM night_reports AS report
           JOIN shift_roles AS role ON role.slug = 'leader'
          WHERE report.leader_id IS NOT NULL
            AND report.status = 'submitted'
            AND report.activity_date < :observationDate
         UNION
         SELECT counter."userId" AS user_id,
                role.id AS shift_role_id,
                counter.date::text AS evidence_date
           FROM counters AS counter
           JOIN shift_roles AS role ON role.slug = 'manager'
          WHERE counter.status = 'final'
            AND counter.date < :observationDate
         ORDER BY user_id, shift_role_id, evidence_date`,
        {
          replacements: { observationDate },
          type: QueryTypes.SELECT,
          transaction,
        },
      )
      : [];

    const evidenceByIdentity = new Map<string, string[]>();
    if (observationDate) {
      roleEvidence.forEach((row) => {
        const userId = normalizePositiveId(row.user_id);
        const shiftRoleId = normalizePositiveId(row.shift_role_id);
        if (
          !userId
          || !shiftRoleId
          || !isIsoDate(row.evidence_date)
          || row.evidence_date >= observationDate
        ) {
          return;
        }
        const key = `${userId}:${shiftRoleId}`;
        const bucket = evidenceByIdentity.get(key) ?? [];
        bucket.push(row.evidence_date);
        evidenceByIdentity.set(key, bucket);
      });
    }

    const shiftRolePeriods: Array<Record<string, unknown>> = [];
    evidenceByIdentity.forEach((dates, identity) => {
      const [userId, shiftRoleId] = identity.split(':').map(Number);
      buildContiguousRanges(dates).forEach((range) => {
        shiftRolePeriods.push({
          user_id: userId,
          shift_role_id: shiftRoleId,
          effective_start: range.start,
          effective_end: range.end,
          created_by: null,
          ended_by: null,
          change_reason: 'Backfilled only for dates supported by schedule, submitted report, or final counter evidence.',
          source: ROLE_EVIDENCE_BACKFILL_SOURCE,
          metadata: JSON.stringify({
            confidence: 'work_evidence_dates_only',
            inferredCapabilityOnlyOnEvidenceDates: true,
            migration: '202608300005',
          }),
          created_at: backfillTimestamp,
          updated_at: backfillTimestamp,
        });
      });
    });
    if (shiftRolePeriods.length > 0) {
      await context.bulkInsert(
        'user_shift_role_membership_periods',
        shiftRolePeriods,
        { transaction },
      );
    }

    // There is no immutable legacy audit for staff_profiles.staff_type. The
    // observed-current rows created by migration 004 are intentionally kept as
    // the only initial staff-type history instead of guessing backward.

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.bulkDelete(
      'user_type_membership_periods',
      { source: AUDIT_BACKFILL_SOURCE },
      { transaction },
    );
    await context.bulkDelete(
      'user_shift_role_membership_periods',
      { source: ROLE_EVIDENCE_BACKFILL_SOURCE },
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(
    `SELECT
       (SELECT COUNT(*)::integer
          FROM user_type_membership_periods
         WHERE source = '${AUDIT_BACKFILL_SOURCE}') AS user_type_backfill_periods,
       (SELECT COUNT(*)::integer
          FROM user_type_membership_periods
         WHERE source = '${AUDIT_BACKFILL_SOURCE}'
           AND effective_end IS NULL) AS open_user_type_backfill_periods,
       (SELECT COUNT(*)::integer
          FROM user_shift_role_membership_periods
         WHERE source = '${ROLE_EVIDENCE_BACKFILL_SOURCE}') AS shift_role_backfill_periods,
       (SELECT COUNT(*)::integer
          FROM user_shift_role_membership_periods
         WHERE source = '${ROLE_EVIDENCE_BACKFILL_SOURCE}'
           AND effective_end IS NULL) AS open_shift_role_backfill_periods;`,
  );
  const result = (rows as Array<Record<string, number>>)[0] ?? {};
  const openUserTypePeriods = Number(result.open_user_type_backfill_periods ?? 0);
  const openShiftRolePeriods = Number(result.open_shift_role_backfill_periods ?? 0);
  return {
    ok: openUserTypePeriods === 0 && openShiftRolePeriods === 0,
    details: result,
  };
}
