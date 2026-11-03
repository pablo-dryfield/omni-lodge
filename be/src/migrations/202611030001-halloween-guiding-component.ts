import type { QueryInterface } from 'sequelize';

type Params = { context: QueryInterface };

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    // Business configuration stays editable in Settings / Compensation Components.
    // Resolve identities in each database; never assume production numeric IDs.
    await context.sequelize.query(`DO $migration$
      DECLARE
        halloween_product_id integer;
        halloween_component_id integer;
        template compensation_components%ROWTYPE;
      BEGIN
        SELECT id INTO halloween_product_id FROM products
          WHERE LOWER(TRIM(name)) = 'halloween pub crawl' ORDER BY id LIMIT 1;
        IF halloween_product_id IS NULL THEN RETURN; END IF;
        SELECT * INTO template FROM compensation_components
          WHERE slug = 'pub-crawl-guiding' AND is_active = TRUE FOR UPDATE;
        IF EXISTS (SELECT 1 FROM compensation_components WHERE slug = 'halloween-pub-crawl-guiding') THEN
          RETURN; -- Preserve any existing administrator configuration on reruns.
        END IF;
        IF template.id IS NULL OR template.default_finance_account_id IS NULL
          OR template.default_finance_category_id IS NULL OR template.currency_code <> 'PLN' THEN
          RAISE EXCEPTION 'Halloween guiding requires an active PLN Pub Crawl Guiding component with finance defaults';
        END IF;
        INSERT INTO compensation_components
          (name, slug, category, calculation_method, description, config, currency_code, is_active,
           default_finance_account_id, default_finance_category_id, created_by, updated_by, created_at, updated_at)
        VALUES ('Halloween Pub Crawl Guiding', 'halloween-pub-crawl-guiding', 'commission', 'per_unit',
          'Halloween guiding: 6 PLN per attendee; same review-target eligibility and manager override as Pub Crawl Guiding.',
          jsonb_build_object('guideCommission', jsonb_build_object(
            'products', jsonb_build_array(jsonb_build_object('productId', halloween_product_id, 'rate', 6)),
            'settlementComponent', TRUE, 'reviewTargetRequired', TRUE))
            || (SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(template.config)
                WHERE key IN ('requiresReviewTarget', 'requires_review_target')),
          'PLN', TRUE, template.default_finance_account_id, template.default_finance_category_id,
          NULL, NULL, NOW(), NOW()) RETURNING id INTO halloween_component_id;

        INSERT INTO compensation_component_assignments
          (component_id, target_scope, shift_role_id, user_id, user_type_id, staff_type,
           effective_start, effective_end, base_amount, unit_amount, currency_code, task_list,
           config, is_active, created_by, updated_by, created_at, updated_at)
        SELECT halloween_component_id, target_scope, shift_role_id, user_id, user_type_id, staff_type,
          effective_start, effective_end, 0, 0, 'PLN', '[]'::jsonb,
          (SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(a.config)
            WHERE key IN ('requiresReviewTarget', 'requires_review_target')),
          TRUE, NULL, NULL, NOW(), NOW()
        FROM compensation_component_assignments a WHERE component_id = template.id AND is_active = TRUE;

        INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta_json, created_at)
        VALUES (NULL, 'compensation_component.seeded', 'compensation_component', halloween_component_id::text,
          jsonb_build_object('source', '202611030001-halloween-guiding-component',
            'reason', 'Separate Halloween guiding with operator-approved rate, shared finance defaults, and review-target rule',
            'templateComponentId', template.id, 'productId', halloween_product_id, 'rate', 6,
            'financeAccountId', template.default_finance_account_id,
            'financeCategoryId', template.default_finance_category_id,
            'assignmentIds', (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb)
              FROM compensation_component_assignments WHERE component_id = halloween_component_id)), NOW());
      END;
    $migration$;`, { transaction });
  });
}

export async function down(): Promise<void> {
  // Preserve financial configuration and settlement identities during a rollback.
}

export async function verify({ context }: Params): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`SELECT
    (NOT EXISTS (SELECT 1 FROM products WHERE LOWER(TRIM(name)) = 'halloween pub crawl')
      OR EXISTS (SELECT 1 FROM compensation_components WHERE slug = 'halloween-pub-crawl-guiding')) AS ready;`);
  const details = (rows as Array<{ ready: boolean }>)[0];
  return { ok: details?.ready === true, details };
}
