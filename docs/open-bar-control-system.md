# Open Bar Control System (Omni-Lodge)

## Objective
Create an operational system to control:
- Drinks served (classic + cocktails + beer + soft drinks)
- Exact ingredient consumption per drink
- Recipes and per-drink ingredient amounts
- Inventory levels, low-stock risk, and par/reorder thresholds
- Deliveries and stock increases
- Service sessions (shift-level service windows)

## Implemented Domain
Backend API namespace: `/api/openBar`

Frontend route: `/open-bar`

### Core entities
- `open_bar_ingredient_categories`
  - Admin-managed categories (Spirit, Mixer, Beer, Garnish, Other, etc.)
  - Ingredients use `category_id` FK (no category enum on ingredient table)
- `open_bar_ingredients`
  - Master bartender-facing ingredients (Rum, Vodka, Whiskey, Gin, Beer, Soft Drink Base, etc.)
  - Tracks base unit (`ml` or `unit`), `parLevel`, `reorderLevel`, weighted `costPerUnit`, active status
- `open_bar_ingredient_variants`
  - Purchasable product variants for each ingredient (brand/package/format)
  - Examples:
    - Ingredient `Beer` -> variants `Corona Can 355ml`, `Draft Keg 30000ml`
    - Ingredient `Gin` -> variants `Gin Brand A 750ml`, `Gin Brand B 1000ml`
    - Ingredient `Lime Wedge` (`unit`) -> variants `Bag 100 pcs`, `Tray 60 pcs`
  - Each variant has `base_quantity` in ingredient base units
- `open_bar_recipes`
  - Drink definitions (classic drinks, cocktails, beer, soft drinks)
  - Includes drink type and instructions
- `open_bar_recipe_ingredients`
  - Ingredient lines for each recipe
  - Quantity per serving and optionality
- `open_bar_sessions`
  - Operational session for a business date
  - Status lifecycle: `draft -> active -> closed`
- `open_bar_drink_issues`
  - Every drink service action logged with servings, time, order ref, bartender
- `open_bar_deliveries`
  - Delivery headers (supplier/invoice/date)
- `open_bar_delivery_items`
  - Delivery lines with variant support:
    - `variant_id` (optional legacy-compatible)
    - `purchase_units`, `purchase_unit_cost`
    - normalized `quantity`, `unit_cost` in ingredient base units
- `open_bar_inventory_movements`
  - Stock ledger of all changes (`delivery`, `issue`, `adjustment`, `waste`, `correction`)
  - Current stock is derived as sum of deltas

## Inventory Accounting Model
- Source of truth: movement ledger (`open_bar_inventory_movements`)
- Stock formula:
  - `currentStock = SUM(quantityDelta by ingredient)`
- Delivery normalization:
  - Variant delivery stores purchased units for audit
  - Inventory movement converts to ingredient base quantity:
    - `normalizedQty = purchaseUnits * variant.baseQuantity`
- Costing:
  - Ingredient `costPerUnit` updates as weighted average on each delivery using pre-delivery stock
- Positive deltas:
  - Deliveries, positive adjustments/corrections
- Negative deltas:
  - Drink issues, waste, negative adjustments/corrections

## Service Workflow
1. Create session (draft) for the business date.
2. Start session (becomes active).
3. Bartender logs drinks via one-tap quick actions in Service Console.
4. System validates required ingredient stock before allowing issue.
5. System writes:
   - drink issue log entry
   - negative inventory movements for each recipe ingredient
6. Add deliveries during the day when stock arrives.
7. Apply waste/correction adjustments when needed.
8. Close session at end of service.

## Bartender UI (Seamless Entry)
Page: `Open Bar Control` (`/open-bar`) with a Service Console:
- Big grouped drink buttons (Classic/Cocktail/Beer/Soft)
- Fast servings selector
- Optional order reference / quick note
- Immediate stock validation feedback
- Recent issue log table for quick verification
- Session control in same view (start/close)

This design minimizes clicks and typing during live bar operations.

## Operational Tabs
- Operation mode split:
  - `Bartender`: service-only workflow for fast drink issue logging
  - `Manager`: full control of sessions, ingredients, categories, products, recipes, deliveries, and overview
- `Service Console`: high-speed drink entry for bartenders
- `Ingredients`: stock board + add/edit ingredient + manual adjustments
- `Categories`: category catalog + add/edit category
- `Products`: product variant catalog + add/edit variant
- `Recipes`: create recipe + view recipe composition and estimated cost
- `Deliveries`: register inbound stock by product variant and purchased units
- `Overview`: top drinks, ingredient usage, low-stock and cost snapshot

## Validation and Controls
- Cannot issue drinks unless session is `active`
- Stock insufficiency blocks drink issue and returns shortage details
- Duplicate ingredient lines are blocked in recipe creation
- Duplicate delivery lines are blocked per ingredient line key / variant key
- Negative stock prevention in manual adjustments
- One active session per business date enforced at start
- New ingredients auto-create a default `Generic` product variant for immediate delivery use
- Base unit changes on ingredients are guarded:
  - If historical quantities exist, `unitConversionFactor` is required
  - Historical recipe/delivery/movement/variant quantities are converted transactionally
- Product variant base quantity is immutable once used in deliveries; create a new variant version instead
- Session close supports reconciliation payload:
  - physical counted stock vs system stock
  - auto-posted `correction` inventory movements for deltas

## API Endpoints
- `GET /api/openBar/overview`
- `GET /api/openBar/ingredients`
- `POST /api/openBar/ingredients`
- `PATCH /api/openBar/ingredients/:id`
- `GET /api/openBar/ingredient-categories`
- `POST /api/openBar/ingredient-categories`
- `PATCH /api/openBar/ingredient-categories/:id`
- `GET /api/openBar/ingredient-variants`
- `POST /api/openBar/ingredient-variants`
- `PATCH /api/openBar/ingredient-variants/:id`
- `GET /api/openBar/recipes`
- `POST /api/openBar/recipes`
- `PATCH /api/openBar/recipes/:id`
- `PUT /api/openBar/recipes/:id/ingredients`
- `GET /api/openBar/sessions`
- `POST /api/openBar/sessions`
- `POST /api/openBar/sessions/:id/start`
- `POST /api/openBar/sessions/:id/close`
  - Supports optional body `{ reconciliation: [{ ingredientId, countedStock }] }`
- `GET /api/openBar/drink-issues`
- `POST /api/openBar/drink-issues`
- `GET /api/openBar/deliveries`
- `POST /api/openBar/deliveries`
- `POST /api/openBar/inventory-adjustments`

## Seeded Baseline
Migration seeds:
- Ingredients:
  - Rum, Vodka, Whiskey, Gin, Beer, Soft Drink Base, Lime Juice, Sugar Syrup, Triple Sec, Cola, Tonic Water, Orange Juice
- Drinks:
  - Rum/Vodka/Whiskey/Gin (classic), Beer, Soft Drink
  - Cuba Libre, Gin & Tonic, Whiskey Sour, Screwdriver

## Suggested Operating Policy
- Require bartender to select an active session before first issue
- Use `orderRef` for group/order tracing
- Log waste as it happens (not end-of-night lump sum)
- Register each delivery immediately to avoid false shortage alerts
- Review low-stock and top-consumption every day before shift open
- Use the procurement plan to refill to par using active product variants
- Require reconciliation at session close for a clean next-day opening stock
