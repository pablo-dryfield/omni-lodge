import { QueryTypes, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

type ObservedUserTypeRow = {
  period_id: string;
  user_id: number;
  user_type_id: number;
  effective_start: string;
  user_created_date: string;
};

type ObservedStaffTypeRow = {
  period_id: string;
  user_id: number;
  staff_type: string;
  effective_start: string;
  profile_created_date: string;
};

type CoverageRow = {
  user_id: number;
  effective_start: string;
  effective_end: string | null;
};

type DateRange = {
  start: string;
  end: string;
};

const BASELINE_START = '2026-08-01';
const USER_TYPE_BASELINE_SOURCE = 'migration_202608300006_user_type_business_baseline';
const STAFF_TYPE_BASELINE_SOURCE = 'migration_202608300006_staff_type_business_baseline';

const isIsoDate = (value: unknown): value is string => (
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
);

const normalizePositiveId = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

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

const maxDate = (left: string, right: string): string => (left > right ? left : right);
const minDate = (left: string, right: string): string => (left < right ? left : right);

/** Return inclusive, contiguous islands not covered by any persisted period. */
const buildUncoveredIslands = (
  start: string,
  end: string,
  coverage: CoverageRow[],
): DateRange[] => {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) {
    return [];
  }

  const clippedCoverage = coverage
    .filter((period) => (
      isIsoDate(period.effective_start)
      && (period.effective_end === null || isIsoDate(period.effective_end))
    ))
    .map((period) => ({
      start: maxDate(start, period.effective_start),
      end: minDate(end, period.effective_end ?? end),
    }))
    .filter((period) => period.start <= period.end)
    .sort((left, right) => (
      left.start.localeCompare(right.start) || left.end.localeCompare(right.end)
    ));

  const gaps: DateRange[] = [];
  let cursor = start;
  clippedCoverage.forEach((period) => {
    if (cursor > end) {
      return;
    }
    if (period.start > cursor) {
      gaps.push({ start: cursor, end: previousDate(period.start) });
    }
    if (period.end >= cursor) {
      cursor = nextDate(period.end);
    }
  });
  if (cursor <= end) {
    gaps.push({ start: cursor, end });
  }
  return gaps;
};

const groupCoverageByUser = (rows: CoverageRow[]): Map<number, CoverageRow[]> => {
  const grouped = new Map<number, CoverageRow[]>();
  rows.forEach((row) => {
    const userId = normalizePositiveId(row.user_id);
    if (!userId || !isIsoDate(row.effective_start)) {
      return;
    }
    const bucket = grouped.get(userId) ?? [];
    bucket.push(row);
    grouped.set(userId, bucket);
  });
  return grouped;
};

const buildBaselineMetadata = (params: {
  observedPeriodId: string;
  observedCurrentStart: string;
  dimension: 'user_type' | 'staff_type';
  creationDate: string;
}): Record<string, unknown> => ({
  legacyExtrapolation: true,
  confidence: 'explicit_business_baseline_projection',
  businessBaseline: {
    approvedStart: BASELINE_START,
    dimension: params.dimension,
    observedCurrentPeriodId: params.observedPeriodId,
    observedCurrentStart: params.observedCurrentStart,
    creationDate: params.creationDate,
    appliedStart: maxDate(BASELINE_START, params.creationDate),
    projectionSource: 'migration_current_state',
    strategy: 'fill_uncovered_gap_islands_only',
  },
  migration: '202608300006',
});

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    // Prevent an application write between coverage discovery and insertion.
    // The exclusion constraints remain the final database-level guard.
    await context.sequelize.query(
      `LOCK TABLE user_type_membership_periods,
                  staff_profile_type_periods
         IN SHARE ROW EXCLUSIVE MODE;`,
      { transaction },
    );

    const observedUserTypes = await context.sequelize.query<ObservedUserTypeRow>(
      `SELECT DISTINCT ON (period.user_id)
              period.id::text AS period_id,
              period.user_id,
              period.user_type_id,
              period.effective_start::text AS effective_start,
              (users."createdAt" AT TIME ZONE 'Europe/Warsaw')::date::text
                AS user_created_date
         FROM user_type_membership_periods AS period
         JOIN users ON users.id = period.user_id
        WHERE period.source = 'migration_current_state'
        ORDER BY period.user_id, period.effective_start, period.id`,
      { type: QueryTypes.SELECT, transaction },
    );
    const userTypeCoverage = await context.sequelize.query<CoverageRow>(
      `SELECT user_id,
              effective_start::text AS effective_start,
              effective_end::text AS effective_end
         FROM user_type_membership_periods
        WHERE effective_end IS NULL
           OR effective_end >= DATE '${BASELINE_START}'
        ORDER BY user_id, effective_start, id`,
      { type: QueryTypes.SELECT, transaction },
    );
    const userTypeCoverageByUser = groupCoverageByUser(userTypeCoverage);
    const backfillTimestamp = new Date();
    const userTypeRows: Array<Record<string, unknown>> = [];

    observedUserTypes.forEach((observed) => {
      const userId = normalizePositiveId(observed.user_id);
      const userTypeId = normalizePositiveId(observed.user_type_id);
      if (
        !userId
        || !userTypeId
        || !isIsoDate(observed.effective_start)
        || !isIsoDate(observed.user_created_date)
      ) {
        return;
      }
      const baselineEnd = previousDate(observed.effective_start);
      const baselineStart = maxDate(BASELINE_START, observed.user_created_date);
      buildUncoveredIslands(
        baselineStart,
        baselineEnd,
        userTypeCoverageByUser.get(userId) ?? [],
      ).forEach((gap) => {
        userTypeRows.push({
          user_id: userId,
          user_type_id: userTypeId,
          effective_start: gap.start,
          effective_end: gap.end,
          created_by: null,
          ended_by: null,
          change_reason: 'Explicit August 2026 business baseline projected from the migration-004 observed user type only for uncovered dates.',
          source: USER_TYPE_BASELINE_SOURCE,
          metadata: JSON.stringify(buildBaselineMetadata({
            observedPeriodId: observed.period_id,
            observedCurrentStart: observed.effective_start,
            dimension: 'user_type',
            creationDate: observed.user_created_date,
          })),
          created_at: backfillTimestamp,
          updated_at: backfillTimestamp,
        });
      });
    });
    if (userTypeRows.length > 0) {
      await context.bulkInsert('user_type_membership_periods', userTypeRows, { transaction });
    }

    const observedStaffTypes = await context.sequelize.query<ObservedStaffTypeRow>(
      `SELECT DISTINCT ON (period.user_id)
              period.id::text AS period_id,
              period.user_id,
              period.staff_type,
              period.effective_start::text AS effective_start,
              (profile."createdAt" AT TIME ZONE 'Europe/Warsaw')::date::text
                AS profile_created_date
         FROM staff_profile_type_periods AS period
         JOIN staff_profiles AS profile ON profile.user_id = period.user_id
        WHERE period.source = 'migration_current_state'
        ORDER BY period.user_id, period.effective_start, period.id`,
      { type: QueryTypes.SELECT, transaction },
    );
    const staffTypeCoverage = await context.sequelize.query<CoverageRow>(
      `SELECT user_id,
              effective_start::text AS effective_start,
              effective_end::text AS effective_end
         FROM staff_profile_type_periods
        WHERE effective_end IS NULL
           OR effective_end >= DATE '${BASELINE_START}'
        ORDER BY user_id, effective_start, id`,
      { type: QueryTypes.SELECT, transaction },
    );
    const staffTypeCoverageByUser = groupCoverageByUser(staffTypeCoverage);
    const staffTypeRows: Array<Record<string, unknown>> = [];

    observedStaffTypes.forEach((observed) => {
      const userId = normalizePositiveId(observed.user_id);
      if (
        !userId
        || !observed.staff_type
        || !isIsoDate(observed.effective_start)
        || !isIsoDate(observed.profile_created_date)
      ) {
        return;
      }
      const baselineEnd = previousDate(observed.effective_start);
      const baselineStart = maxDate(BASELINE_START, observed.profile_created_date);
      buildUncoveredIslands(
        baselineStart,
        baselineEnd,
        staffTypeCoverageByUser.get(userId) ?? [],
      ).forEach((gap) => {
        staffTypeRows.push({
          user_id: userId,
          staff_type: observed.staff_type,
          effective_start: gap.start,
          effective_end: gap.end,
          created_by: null,
          ended_by: null,
          change_reason: 'Explicit August 2026 business baseline projected from the migration-004 observed staff type only for uncovered dates.',
          source: STAFF_TYPE_BASELINE_SOURCE,
          metadata: JSON.stringify(buildBaselineMetadata({
            observedPeriodId: observed.period_id,
            observedCurrentStart: observed.effective_start,
            dimension: 'staff_type',
            creationDate: observed.profile_created_date,
          })),
          created_at: backfillTimestamp,
          updated_at: backfillTimestamp,
        });
      });
    });
    if (staffTypeRows.length > 0) {
      await context.bulkInsert('staff_profile_type_periods', staffTypeRows, { transaction });
    }

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
      { source: USER_TYPE_BASELINE_SOURCE },
      { transaction },
    );
    await context.bulkDelete(
      'staff_profile_type_periods',
      { source: STAFF_TYPE_BASELINE_SOURCE },
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
         WHERE source = '${USER_TYPE_BASELINE_SOURCE}') AS user_type_baseline_periods,
       (SELECT COUNT(*)::integer
          FROM user_type_membership_periods AS baseline
          LEFT JOIN user_type_membership_periods AS observed
            ON observed.id::text = baseline.metadata #>> '{businessBaseline,observedCurrentPeriodId}'
           AND observed.source = 'migration_current_state'
          LEFT JOIN users AS baseline_user ON baseline_user.id = baseline.user_id
         WHERE baseline.source = '${USER_TYPE_BASELINE_SOURCE}'
           AND (
             baseline.effective_start < DATE '${BASELINE_START}'
             OR baseline_user.id IS NULL
             OR baseline.effective_start
                  < (baseline_user."createdAt" AT TIME ZONE 'Europe/Warsaw')::date
             OR baseline.effective_end IS NULL
             OR observed.id IS NULL
             OR baseline.user_type_id IS DISTINCT FROM observed.user_type_id
             OR baseline.effective_end >= observed.effective_start
             OR baseline.metadata->>'legacyExtrapolation' IS DISTINCT FROM 'true'
             OR baseline.metadata->>'confidence' IS DISTINCT FROM 'explicit_business_baseline_projection'
           ))
         AS invalid_user_type_baseline_periods,
       (SELECT COUNT(*)::integer
          FROM staff_profile_type_periods
         WHERE source = '${STAFF_TYPE_BASELINE_SOURCE}') AS staff_type_baseline_periods,
       (SELECT COUNT(*)::integer
          FROM staff_profile_type_periods AS baseline
          LEFT JOIN staff_profile_type_periods AS observed
            ON observed.id::text = baseline.metadata #>> '{businessBaseline,observedCurrentPeriodId}'
           AND observed.source = 'migration_current_state'
          LEFT JOIN staff_profiles AS baseline_profile
            ON baseline_profile.user_id = baseline.user_id
         WHERE baseline.source = '${STAFF_TYPE_BASELINE_SOURCE}'
           AND (
             baseline.effective_start < DATE '${BASELINE_START}'
             OR baseline_profile.user_id IS NULL
             OR baseline.effective_start
                  < (baseline_profile."createdAt" AT TIME ZONE 'Europe/Warsaw')::date
             OR baseline.effective_end IS NULL
             OR observed.id IS NULL
             OR baseline.staff_type IS DISTINCT FROM observed.staff_type
             OR baseline.effective_end >= observed.effective_start
             OR baseline.metadata->>'legacyExtrapolation' IS DISTINCT FROM 'true'
             OR baseline.metadata->>'confidence' IS DISTINCT FROM 'explicit_business_baseline_projection'
           ))
         AS invalid_staff_type_baseline_periods;`,
  );
  const result = (rows as Array<Record<string, number>>)[0] ?? {};
  return {
    ok: Number(result.invalid_user_type_baseline_periods ?? 0) === 0
      && Number(result.invalid_staff_type_baseline_periods ?? 0) === 0,
    details: result,
  };
}
