import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_INGREDIENTS = 'open_bar_ingredients';
const TABLE_RECIPES = 'open_bar_recipes';
const TABLE_RECIPE_INGREDIENTS = 'open_bar_recipe_ingredients';
const TABLE_SESSIONS = 'open_bar_sessions';
const TABLE_DRINK_ISSUES = 'open_bar_drink_issues';
const TABLE_DELIVERIES = 'open_bar_deliveries';
const TABLE_DELIVERY_ITEMS = 'open_bar_delivery_items';
const TABLE_MOVEMENTS = 'open_bar_inventory_movements';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      TABLE_INGREDIENTS,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING(120),
          allowNull: false,
          unique: true,
        },
        category: {
          type: DataTypes.ENUM('spirit', 'mixer', 'beer', 'soft_drink', 'garnish', 'other'),
          allowNull: false,
          defaultValue: 'other',
        },
        base_unit: {
          type: DataTypes.ENUM('ml', 'unit'),
          allowNull: false,
          defaultValue: 'ml',
        },
        par_level: {
          type: DataTypes.DECIMAL(12, 3),
          allowNull: false,
          defaultValue: 0,
        },
        reorder_level: {
          type: DataTypes.DECIMAL(12, 3),
          allowNull: false,
          defaultValue: 0,
        },
        cost_per_unit: {
          type: DataTypes.DECIMAL(12, 4),
          allowNull: true,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        created_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        updated_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addIndex(TABLE_INGREDIENTS, ['is_active'], {
      name: 'open_bar_ingredients_active_idx',
      transaction,
    });

    await qi.createTable(
      TABLE_RECIPES,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING(120),
          allowNull: false,
          unique: true,
        },
        drink_type: {
          type: DataTypes.ENUM('classic', 'cocktail', 'beer', 'soft', 'custom'),
          allowNull: false,
          defaultValue: 'custom',
        },
        default_servings: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        instructions: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        created_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        updated_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addIndex(TABLE_RECIPES, ['is_active'], {
      name: 'open_bar_recipes_active_idx',
      transaction,
    });

    await qi.createTable(
      TABLE_RECIPE_INGREDIENTS,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        recipe_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_RECIPES, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        ingredient_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_INGREDIENTS, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        quantity: {
          type: DataTypes.DECIMAL(12, 3),
          allowNull: false,
        },
        sort_order: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        is_optional: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addConstraint(TABLE_RECIPE_INGREDIENTS, {
      type: 'unique',
      name: 'open_bar_recipe_ingredients_recipe_ingredient_uq',
      fields: ['recipe_id', 'ingredient_id'],
      transaction,
    });

    await qi.addIndex(TABLE_RECIPE_INGREDIENTS, ['recipe_id'], {
      name: 'open_bar_recipe_ingredients_recipe_idx',
      transaction,
    });

    await qi.addIndex(TABLE_RECIPE_INGREDIENTS, ['ingredient_id'], {
      name: 'open_bar_recipe_ingredients_ingredient_idx',
      transaction,
    });

    await qi.createTable(
      TABLE_SESSIONS,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        session_name: {
          type: DataTypes.STRING(160),
          allowNull: false,
        },
        business_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        venue_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'venues', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        night_report_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'night_reports', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        status: {
          type: DataTypes.ENUM('draft', 'active', 'closed'),
          allowNull: false,
          defaultValue: 'draft',
        },
        opened_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        closed_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        notes: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        created_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        updated_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addIndex(TABLE_SESSIONS, ['business_date', 'status'], {
      name: 'open_bar_sessions_date_status_idx',
      transaction,
    });

    await qi.createTable(
      TABLE_DRINK_ISSUES,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        session_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_SESSIONS, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        recipe_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_RECIPES, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        servings: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        issued_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        order_ref: {
          type: DataTypes.STRING(120),
          allowNull: true,
        },
        notes: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        issued_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addIndex(TABLE_DRINK_ISSUES, ['session_id', 'issued_at'], {
      name: 'open_bar_drink_issues_session_issued_idx',
      transaction,
    });

    await qi.createTable(
      TABLE_DELIVERIES,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        supplier_name: {
          type: DataTypes.STRING(160),
          allowNull: true,
        },
        invoice_ref: {
          type: DataTypes.STRING(120),
          allowNull: true,
        },
        delivered_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        notes: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        received_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.createTable(
      TABLE_DELIVERY_ITEMS,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        delivery_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_DELIVERIES, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        ingredient_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_INGREDIENTS, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        quantity: {
          type: DataTypes.DECIMAL(12, 3),
          allowNull: false,
        },
        unit_cost: {
          type: DataTypes.DECIMAL(12, 4),
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addConstraint(TABLE_DELIVERY_ITEMS, {
      type: 'unique',
      name: 'open_bar_delivery_items_delivery_ingredient_uq',
      fields: ['delivery_id', 'ingredient_id'],
      transaction,
    });

    await qi.addIndex(TABLE_DELIVERY_ITEMS, ['ingredient_id'], {
      name: 'open_bar_delivery_items_ingredient_idx',
      transaction,
    });

    await qi.createTable(
      TABLE_MOVEMENTS,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        ingredient_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_INGREDIENTS, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        movement_type: {
          type: DataTypes.ENUM('delivery', 'issue', 'adjustment', 'waste', 'correction'),
          allowNull: false,
        },
        quantity_delta: {
          type: DataTypes.DECIMAL(12, 3),
          allowNull: false,
        },
        occurred_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        session_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: TABLE_SESSIONS, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        delivery_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: TABLE_DELIVERIES, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        issue_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: TABLE_DRINK_ISSUES, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        note: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        created_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addIndex(TABLE_MOVEMENTS, ['ingredient_id', 'occurred_at'], {
      name: 'open_bar_inventory_movements_ingredient_occurred_idx',
      transaction,
    });

    await qi.addIndex(TABLE_MOVEMENTS, ['movement_type'], {
      name: 'open_bar_inventory_movements_type_idx',
      transaction,
    });

    const ingredientSeeds = [
      { name: 'Rum', category: 'spirit', baseUnit: 'ml', parLevel: 3000, reorderLevel: 1000, isActive: true },
      { name: 'Vodka', category: 'spirit', baseUnit: 'ml', parLevel: 3000, reorderLevel: 1000, isActive: true },
      { name: 'Whiskey', category: 'spirit', baseUnit: 'ml', parLevel: 3000, reorderLevel: 1000, isActive: true },
      { name: 'Gin', category: 'spirit', baseUnit: 'ml', parLevel: 3000, reorderLevel: 1000, isActive: true },
      { name: 'Beer', category: 'beer', baseUnit: 'ml', parLevel: 90000, reorderLevel: 30000, isActive: true },
      { name: 'Soft Drink Base', category: 'soft_drink', baseUnit: 'ml', parLevel: 10000, reorderLevel: 3000, isActive: true },
      { name: 'Lime Juice', category: 'mixer', baseUnit: 'ml', parLevel: 1500, reorderLevel: 500, isActive: true },
      { name: 'Sugar Syrup', category: 'mixer', baseUnit: 'ml', parLevel: 1200, reorderLevel: 400, isActive: true },
      { name: 'Triple Sec', category: 'spirit', baseUnit: 'ml', parLevel: 1200, reorderLevel: 300, isActive: true },
      { name: 'Cola', category: 'soft_drink', baseUnit: 'ml', parLevel: 6000, reorderLevel: 2000, isActive: true },
      { name: 'Tonic Water', category: 'soft_drink', baseUnit: 'ml', parLevel: 6000, reorderLevel: 2000, isActive: true },
      { name: 'Orange Juice', category: 'soft_drink', baseUnit: 'ml', parLevel: 5000, reorderLevel: 1500, isActive: true },
    ];

    for (const row of ingredientSeeds) {
      await qi.sequelize.query(
        `INSERT INTO ${TABLE_INGREDIENTS}
          (name, category, base_unit, par_level, reorder_level, is_active, created_at, updated_at)
         VALUES
          (:name, :category, :baseUnit, :parLevel, :reorderLevel, :isActive, NOW(), NOW())
         ON CONFLICT (name)
         DO UPDATE SET
           category = EXCLUDED.category,
           base_unit = EXCLUDED.base_unit,
           par_level = EXCLUDED.par_level,
           reorder_level = EXCLUDED.reorder_level,
           is_active = EXCLUDED.is_active,
           updated_at = NOW();`,
        { transaction, replacements: row },
      );
    }

    const recipeSeeds = [
      { name: 'Rum (Classic)', drinkType: 'classic', defaultServings: 1, instructions: 'Single rum pour over ice.' },
      { name: 'Vodka (Classic)', drinkType: 'classic', defaultServings: 1, instructions: 'Single vodka pour over ice.' },
      { name: 'Whiskey (Classic)', drinkType: 'classic', defaultServings: 1, instructions: 'Single whiskey pour over ice.' },
      { name: 'Gin (Classic)', drinkType: 'classic', defaultServings: 1, instructions: 'Single gin pour over ice.' },
      { name: 'Beer', drinkType: 'beer', defaultServings: 1, instructions: 'Serve 1 beer unit.' },
      { name: 'Soft Drink', drinkType: 'soft', defaultServings: 1, instructions: 'Serve 250 ml soft drink base.' },
      { name: 'Cuba Libre', drinkType: 'cocktail', defaultServings: 1, instructions: 'Rum, cola, fresh lime.' },
      { name: 'Gin & Tonic', drinkType: 'cocktail', defaultServings: 1, instructions: 'Gin topped with tonic.' },
      { name: 'Whiskey Sour', drinkType: 'cocktail', defaultServings: 1, instructions: 'Whiskey, lime, sugar syrup.' },
      { name: 'Screwdriver', drinkType: 'cocktail', defaultServings: 1, instructions: 'Vodka and orange juice.' },
    ];

    for (const row of recipeSeeds) {
      await qi.sequelize.query(
        `INSERT INTO ${TABLE_RECIPES}
          (name, drink_type, default_servings, instructions, is_active, created_at, updated_at)
         VALUES
          (:name, :drinkType, :defaultServings, :instructions, true, NOW(), NOW())
         ON CONFLICT (name)
         DO UPDATE SET
           drink_type = EXCLUDED.drink_type,
           default_servings = EXCLUDED.default_servings,
           instructions = EXCLUDED.instructions,
           is_active = true,
           updated_at = NOW();`,
        { transaction, replacements: row },
      );
    }

    const recipeIngredientSeeds = [
      { recipeName: 'Rum (Classic)', ingredientName: 'Rum', quantity: 50, sortOrder: 1 },
      { recipeName: 'Vodka (Classic)', ingredientName: 'Vodka', quantity: 50, sortOrder: 1 },
      { recipeName: 'Whiskey (Classic)', ingredientName: 'Whiskey', quantity: 50, sortOrder: 1 },
      { recipeName: 'Gin (Classic)', ingredientName: 'Gin', quantity: 50, sortOrder: 1 },
      { recipeName: 'Beer', ingredientName: 'Beer', quantity: 355, sortOrder: 1 },
      { recipeName: 'Soft Drink', ingredientName: 'Soft Drink Base', quantity: 250, sortOrder: 1 },
      { recipeName: 'Cuba Libre', ingredientName: 'Rum', quantity: 50, sortOrder: 1 },
      { recipeName: 'Cuba Libre', ingredientName: 'Cola', quantity: 120, sortOrder: 2 },
      { recipeName: 'Cuba Libre', ingredientName: 'Lime Juice', quantity: 10, sortOrder: 3 },
      { recipeName: 'Gin & Tonic', ingredientName: 'Gin', quantity: 50, sortOrder: 1 },
      { recipeName: 'Gin & Tonic', ingredientName: 'Tonic Water', quantity: 120, sortOrder: 2 },
      { recipeName: 'Whiskey Sour', ingredientName: 'Whiskey', quantity: 50, sortOrder: 1 },
      { recipeName: 'Whiskey Sour', ingredientName: 'Lime Juice', quantity: 20, sortOrder: 2 },
      { recipeName: 'Whiskey Sour', ingredientName: 'Sugar Syrup', quantity: 15, sortOrder: 3 },
      { recipeName: 'Screwdriver', ingredientName: 'Vodka', quantity: 50, sortOrder: 1 },
      { recipeName: 'Screwdriver', ingredientName: 'Orange Juice', quantity: 120, sortOrder: 2 },
    ];

    for (const row of recipeIngredientSeeds) {
      await qi.sequelize.query(
        `INSERT INTO ${TABLE_RECIPE_INGREDIENTS}
          (recipe_id, ingredient_id, quantity, sort_order, is_optional, created_at, updated_at)
         SELECT
          recipes.id,
          ingredients.id,
          :quantity,
          :sortOrder,
          false,
          NOW(),
          NOW()
         FROM ${TABLE_RECIPES} AS recipes
         JOIN ${TABLE_INGREDIENTS} AS ingredients
           ON ingredients.name = :ingredientName
         WHERE recipes.name = :recipeName
         ON CONFLICT (recipe_id, ingredient_id)
         DO UPDATE SET
           quantity = EXCLUDED.quantity,
           sort_order = EXCLUDED.sort_order,
           is_optional = EXCLUDED.is_optional,
           updated_at = NOW();`,
        { transaction, replacements: row },
      );
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.dropTable(TABLE_MOVEMENTS, { transaction });
    await qi.dropTable(TABLE_DELIVERY_ITEMS, { transaction });
    await qi.dropTable(TABLE_DELIVERIES, { transaction });
    await qi.dropTable(TABLE_DRINK_ISSUES, { transaction });
    await qi.dropTable(TABLE_SESSIONS, { transaction });
    await qi.dropTable(TABLE_RECIPE_INGREDIENTS, { transaction });
    await qi.dropTable(TABLE_RECIPES, { transaction });
    await qi.dropTable(TABLE_INGREDIENTS, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
