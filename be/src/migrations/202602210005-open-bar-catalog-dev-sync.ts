import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_CATEGORIES = 'open_bar_ingredient_categories';
const TABLE_INGREDIENTS = 'open_bar_ingredients';
const TABLE_VARIANTS = 'open_bar_ingredient_variants';
const TABLE_RECIPES = 'open_bar_recipes';
const TABLE_RECIPE_INGREDIENTS = 'open_bar_recipe_ingredients';

const OPEN_BAR_DEV_SNAPSHOT = {
  "categories": [
    {
      "name": "Spirit",
      "slug": "spirit",
      "sortOrder": 0,
      "isActive": true
    },
    {
      "name": "Soft Drink",
      "slug": "soft_drink",
      "sortOrder": 0,
      "isActive": true
    },
    {
      "name": "Beer",
      "slug": "beer",
      "sortOrder": 0,
      "isActive": true
    },
    {
      "name": "Liqueur",
      "slug": "liqueur",
      "sortOrder": 0,
      "isActive": true
    },
    {
      "name": "Food",
      "slug": "food",
      "sortOrder": 0,
      "isActive": true
    },
    {
      "name": "Syrup",
      "slug": "syrup",
      "sortOrder": 0,
      "isActive": true
    },
    {
      "name": "Modifier",
      "slug": "modifier",
      "sortOrder": 0,
      "isActive": true
    },
    {
      "name": "Ice",
      "slug": "ice",
      "sortOrder": 0,
      "isActive": true
    },
    {
      "name": "Disposable",
      "slug": "disposable",
      "sortOrder": 0,
      "isActive": true
    },
    {
      "name": "Wine",
      "slug": "wine",
      "sortOrder": 0,
      "isActive": true
    }
  ],
  "ingredients": [
    {
      "name": "Rum",
      "categorySlug": "spirit",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Vodka",
      "categorySlug": "spirit",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Whiskey",
      "categorySlug": "spirit",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Gin",
      "categorySlug": "spirit",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Beer",
      "categorySlug": "spirit",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Orange Juice",
      "categorySlug": "soft_drink",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Coke",
      "categorySlug": "soft_drink",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Coke Zero",
      "categorySlug": "soft_drink",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Lemonade",
      "categorySlug": "soft_drink",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Grapefruit Juice",
      "categorySlug": "soft_drink",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Multi Vitamin Juice",
      "categorySlug": "soft_drink",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Apple Juice",
      "categorySlug": "soft_drink",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Tonic",
      "categorySlug": "soft_drink",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Ice",
      "categorySlug": "ice",
      "baseUnit": "unit",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": true
    },
    {
      "name": "Cranberry Juice",
      "categorySlug": "soft_drink",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Lime",
      "categorySlug": "food",
      "baseUnit": "unit",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Mint",
      "categorySlug": "food",
      "baseUnit": "unit",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Sugar",
      "categorySlug": "food",
      "baseUnit": "unit",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Sparkling Water",
      "categorySlug": "soft_drink",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Plastic Cup 200 ml",
      "categorySlug": "disposable",
      "baseUnit": "unit",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": true,
      "cupType": "disposable",
      "cupCapacityMl": "200.000",
      "isIce": false
    },
    {
      "name": "Plastic Cup 300 ml",
      "categorySlug": "disposable",
      "baseUnit": "unit",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": true,
      "cupType": "disposable",
      "cupCapacityMl": "300.000",
      "isIce": false
    },
    {
      "name": "Straw",
      "categorySlug": "disposable",
      "baseUnit": "unit",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Coconut Syrup",
      "categorySlug": "syrup",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Ginger Syrup",
      "categorySlug": "syrup",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Sour",
      "categorySlug": "modifier",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Peach Liqueur",
      "categorySlug": "liqueur",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Prosecco",
      "categorySlug": "wine",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Aperitivo",
      "categorySlug": "modifier",
      "baseUnit": "ml",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": false,
      "cupType": null,
      "cupCapacityMl": null,
      "isIce": false
    },
    {
      "name": "Reusable Cup 350 ml",
      "categorySlug": "beer",
      "baseUnit": "unit",
      "parLevel": "0.000",
      "reorderLevel": "0.000",
      "costPerUnit": null,
      "isActive": true,
      "isCup": true,
      "cupType": "disposable",
      "cupCapacityMl": "350.000",
      "isIce": false
    }
  ],
  "variants": [
    {
      "ingredientName": "Rum",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Vodka",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Whiskey",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Gin",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Beer",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Orange Juice",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Coke",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Coke Zero",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Lemonade",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Grapefruit Juice",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Multi Vitamin Juice",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Apple Juice",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Tonic",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Ice",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Cranberry Juice",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Lime",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Mint",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Sugar",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Sparkling Water",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Plastic Cup 200 ml",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Plastic Cup 300 ml",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Straw",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Coconut Syrup",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Ginger Syrup",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Sour",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Peach Liqueur",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Prosecco",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Aperitivo",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    },
    {
      "ingredientName": "Reusable Cup 350 ml",
      "name": "Generic",
      "brand": null,
      "packageLabel": "Generic",
      "baseQuantity": "1.000",
      "isActive": true
    }
  ],
  "recipes": [
    {
      "name": "Rum",
      "drinkType": "classic",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": true,
      "hasIce": true,
      "iceCubes": 3,
      "cupIngredientName": "Plastic Cup 200 ml"
    },
    {
      "name": "Gin",
      "drinkType": "classic",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": true,
      "hasIce": true,
      "iceCubes": 3,
      "cupIngredientName": "Plastic Cup 200 ml"
    },
    {
      "name": "Whiskey",
      "drinkType": "classic",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": true,
      "hasIce": true,
      "iceCubes": 3,
      "cupIngredientName": "Plastic Cup 200 ml"
    },
    {
      "name": "Vodka",
      "drinkType": "classic",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": true,
      "hasIce": true,
      "iceCubes": 3,
      "cupIngredientName": "Plastic Cup 200 ml"
    },
    {
      "name": "Beer",
      "drinkType": "beer",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": false,
      "hasIce": false,
      "iceCubes": 0,
      "cupIngredientName": "Plastic Cup 300 ml"
    },
    {
      "name": "Sex on the Beach",
      "drinkType": "cocktail",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": true,
      "hasIce": true,
      "iceCubes": 4,
      "cupIngredientName": "Reusable Cup 350 ml"
    },
    {
      "name": "Coconut Mojito",
      "drinkType": "cocktail",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": false,
      "hasIce": true,
      "iceCubes": 3,
      "cupIngredientName": "Reusable Cup 350 ml"
    },
    {
      "name": "Cuba Libre",
      "drinkType": "cocktail",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": false,
      "hasIce": true,
      "iceCubes": 3,
      "cupIngredientName": "Reusable Cup 350 ml"
    },
    {
      "name": "Aperol Spritz",
      "drinkType": "cocktail",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": false,
      "hasIce": true,
      "iceCubes": 3,
      "cupIngredientName": "Reusable Cup 350 ml"
    },
    {
      "name": "Lemon Ginger Whiskey",
      "drinkType": "cocktail",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": false,
      "hasIce": true,
      "iceCubes": 3,
      "cupIngredientName": "Reusable Cup 350 ml"
    },
    {
      "name": "Tom Collins",
      "drinkType": "cocktail",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": false,
      "hasIce": true,
      "iceCubes": 3,
      "cupIngredientName": "Reusable Cup 350 ml"
    },
    {
      "name": "Soft Drinks",
      "drinkType": "soft",
      "defaultServings": 1,
      "labelDisplayMode": null,
      "instructions": null,
      "isActive": true,
      "askStrength": false,
      "hasIce": true,
      "iceCubes": 3,
      "cupIngredientName": "Plastic Cup 200 ml"
    }
  ],
  "recipeIngredients": [
    {
      "recipeName": "Rum",
      "lineType": "fixed_ingredient",
      "ingredientName": "Rum",
      "categorySlug": null,
      "quantity": "30.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": true,
      "isTopUp": false
    },
    {
      "recipeName": "Rum",
      "lineType": "category_selector",
      "ingredientName": null,
      "categorySlug": "soft_drink",
      "quantity": "0.000",
      "sortOrder": 2,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": true
    },
    {
      "recipeName": "Gin",
      "lineType": "fixed_ingredient",
      "ingredientName": "Gin",
      "categorySlug": null,
      "quantity": "30.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": true,
      "isTopUp": false
    },
    {
      "recipeName": "Gin",
      "lineType": "category_selector",
      "ingredientName": null,
      "categorySlug": "soft_drink",
      "quantity": "0.000",
      "sortOrder": 2,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": true
    },
    {
      "recipeName": "Whiskey",
      "lineType": "fixed_ingredient",
      "ingredientName": "Whiskey",
      "categorySlug": null,
      "quantity": "30.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": true,
      "isTopUp": false
    },
    {
      "recipeName": "Whiskey",
      "lineType": "category_selector",
      "ingredientName": null,
      "categorySlug": "soft_drink",
      "quantity": "0.000",
      "sortOrder": 2,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": true
    },
    {
      "recipeName": "Vodka",
      "lineType": "fixed_ingredient",
      "ingredientName": "Vodka",
      "categorySlug": null,
      "quantity": "30.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": true,
      "isTopUp": false
    },
    {
      "recipeName": "Vodka",
      "lineType": "category_selector",
      "ingredientName": null,
      "categorySlug": "soft_drink",
      "quantity": "0.000",
      "sortOrder": 2,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": true
    },
    {
      "recipeName": "Beer",
      "lineType": "fixed_ingredient",
      "ingredientName": "Beer",
      "categorySlug": null,
      "quantity": "280.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Sex on the Beach",
      "lineType": "fixed_ingredient",
      "ingredientName": "Vodka",
      "categorySlug": null,
      "quantity": "40.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Sex on the Beach",
      "lineType": "fixed_ingredient",
      "ingredientName": "Peach Liqueur",
      "categorySlug": null,
      "quantity": "20.000",
      "sortOrder": 2,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Sex on the Beach",
      "lineType": "fixed_ingredient",
      "ingredientName": "Orange Juice",
      "categorySlug": null,
      "quantity": "170.000",
      "sortOrder": 3,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Sex on the Beach",
      "lineType": "fixed_ingredient",
      "ingredientName": "Cranberry Juice",
      "categorySlug": null,
      "quantity": "28.000",
      "sortOrder": 4,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Coconut Mojito",
      "lineType": "fixed_ingredient",
      "ingredientName": "Rum",
      "categorySlug": null,
      "quantity": "40.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Coconut Mojito",
      "lineType": "fixed_ingredient",
      "ingredientName": "Coconut Syrup",
      "categorySlug": null,
      "quantity": "30.000",
      "sortOrder": 2,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Coconut Mojito",
      "lineType": "fixed_ingredient",
      "ingredientName": "Sour",
      "categorySlug": null,
      "quantity": "30.000",
      "sortOrder": 3,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Coconut Mojito",
      "lineType": "fixed_ingredient",
      "ingredientName": "Mint",
      "categorySlug": null,
      "quantity": "1.000",
      "sortOrder": 4,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Coconut Mojito",
      "lineType": "fixed_ingredient",
      "ingredientName": "Sparkling Water",
      "categorySlug": null,
      "quantity": "180.000",
      "sortOrder": 5,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Cuba Libre",
      "lineType": "fixed_ingredient",
      "ingredientName": "Rum",
      "categorySlug": null,
      "quantity": "40.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Cuba Libre",
      "lineType": "fixed_ingredient",
      "ingredientName": "Sour",
      "categorySlug": null,
      "quantity": "20.000",
      "sortOrder": 2,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Cuba Libre",
      "lineType": "fixed_ingredient",
      "ingredientName": "Coke",
      "categorySlug": null,
      "quantity": "200.000",
      "sortOrder": 3,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Aperol Spritz",
      "lineType": "fixed_ingredient",
      "ingredientName": "Aperitivo",
      "categorySlug": null,
      "quantity": "60.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Aperol Spritz",
      "lineType": "fixed_ingredient",
      "ingredientName": "Prosecco",
      "categorySlug": null,
      "quantity": "100.000",
      "sortOrder": 2,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Aperol Spritz",
      "lineType": "fixed_ingredient",
      "ingredientName": "Sparkling Water",
      "categorySlug": null,
      "quantity": "121.000",
      "sortOrder": 3,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Lemon Ginger Whiskey",
      "lineType": "fixed_ingredient",
      "ingredientName": "Whiskey",
      "categorySlug": null,
      "quantity": "40.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Lemon Ginger Whiskey",
      "lineType": "fixed_ingredient",
      "ingredientName": "Ginger Syrup",
      "categorySlug": null,
      "quantity": "30.000",
      "sortOrder": 2,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Lemon Ginger Whiskey",
      "lineType": "fixed_ingredient",
      "ingredientName": "Sour",
      "categorySlug": null,
      "quantity": "30.000",
      "sortOrder": 3,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Lemon Ginger Whiskey",
      "lineType": "fixed_ingredient",
      "ingredientName": "Sparkling Water",
      "categorySlug": null,
      "quantity": "181.000",
      "sortOrder": 4,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Tom Collins",
      "lineType": "fixed_ingredient",
      "ingredientName": "Gin",
      "categorySlug": null,
      "quantity": "40.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Tom Collins",
      "lineType": "fixed_ingredient",
      "ingredientName": "Sour",
      "categorySlug": null,
      "quantity": "30.000",
      "sortOrder": 2,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Tom Collins",
      "lineType": "fixed_ingredient",
      "ingredientName": "Sugar",
      "categorySlug": null,
      "quantity": "30.000",
      "sortOrder": 3,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Tom Collins",
      "lineType": "fixed_ingredient",
      "ingredientName": "Sparkling Water",
      "categorySlug": null,
      "quantity": "180.000",
      "sortOrder": 4,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": false
    },
    {
      "recipeName": "Soft Drinks",
      "lineType": "category_selector",
      "ingredientName": null,
      "categorySlug": "soft_drink",
      "quantity": "0.000",
      "sortOrder": 1,
      "isOptional": false,
      "affectsStrength": false,
      "isTopUp": true
    }
  ]
} as const;

const toNullableText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    for (const category of OPEN_BAR_DEV_SNAPSHOT.categories) {
      await qi.sequelize.query(
        `
        INSERT INTO ${TABLE_CATEGORIES}
          (name, slug, sort_order, is_active, created_at, updated_at)
        VALUES
          (:name, :slug, :sortOrder, :isActive, NOW(), NOW())
        ON CONFLICT (slug)
        DO UPDATE SET
          name = EXCLUDED.name,
          sort_order = EXCLUDED.sort_order,
          is_active = EXCLUDED.is_active,
          updated_at = NOW();`,
        {
          transaction,
          replacements: {
            name: category.name,
            slug: category.slug,
            sortOrder: category.sortOrder,
            isActive: category.isActive,
          },
        },
      );
    }

    for (const ingredient of OPEN_BAR_DEV_SNAPSHOT.ingredients) {
      await qi.sequelize.query(
        `
        INSERT INTO ${TABLE_INGREDIENTS}
          (name, category_id, base_unit, par_level, reorder_level, cost_per_unit, is_active, is_cup, cup_type, cup_capacity_ml, is_ice, created_at, updated_at)
        VALUES
          (
            :name,
            (SELECT id FROM ${TABLE_CATEGORIES} WHERE slug = :categorySlug),
            :baseUnit,
            :parLevel,
            :reorderLevel,
            :costPerUnit,
            :isActive,
            :isCup,
            :cupType,
            :cupCapacityMl,
            :isIce,
            NOW(),
            NOW()
          )
        ON CONFLICT (name)
        DO UPDATE SET
          category_id = EXCLUDED.category_id,
          base_unit = EXCLUDED.base_unit,
          par_level = EXCLUDED.par_level,
          reorder_level = EXCLUDED.reorder_level,
          cost_per_unit = EXCLUDED.cost_per_unit,
          is_active = EXCLUDED.is_active,
          is_cup = EXCLUDED.is_cup,
          cup_type = EXCLUDED.cup_type,
          cup_capacity_ml = EXCLUDED.cup_capacity_ml,
          is_ice = EXCLUDED.is_ice,
          updated_at = NOW();`,
        {
          transaction,
          replacements: {
            name: ingredient.name,
            categorySlug: ingredient.categorySlug,
            baseUnit: ingredient.baseUnit,
            parLevel: ingredient.parLevel,
            reorderLevel: ingredient.reorderLevel,
            costPerUnit: ingredient.costPerUnit,
            isActive: ingredient.isActive,
            isCup: ingredient.isCup,
            cupType: ingredient.cupType,
            cupCapacityMl: ingredient.cupCapacityMl,
            isIce: ingredient.isIce,
          },
        },
      );
    }

    for (const variant of OPEN_BAR_DEV_SNAPSHOT.variants) {
      await qi.sequelize.query(
        `
        INSERT INTO ${TABLE_VARIANTS}
          (ingredient_id, name, brand, package_label, base_quantity, is_active, created_at, updated_at)
        VALUES
          (
            (SELECT id FROM ${TABLE_INGREDIENTS} WHERE name = :ingredientName),
            :name,
            :brand,
            :packageLabel,
            :baseQuantity,
            :isActive,
            NOW(),
            NOW()
          )
        ON CONFLICT (ingredient_id, name)
        DO UPDATE SET
          brand = EXCLUDED.brand,
          package_label = EXCLUDED.package_label,
          base_quantity = EXCLUDED.base_quantity,
          is_active = EXCLUDED.is_active,
          updated_at = NOW();`,
        {
          transaction,
          replacements: {
            ingredientName: variant.ingredientName,
            name: variant.name,
            brand: variant.brand,
            packageLabel: variant.packageLabel,
            baseQuantity: variant.baseQuantity,
            isActive: variant.isActive,
          },
        },
      );
    }

    for (const recipe of OPEN_BAR_DEV_SNAPSHOT.recipes) {
      await qi.sequelize.query(
        `
        INSERT INTO ${TABLE_RECIPES}
          (name, drink_type, default_servings, label_display_mode, instructions, is_active, ask_strength, has_ice, ice_cubes, cup_ingredient_id, created_at, updated_at)
        VALUES
          (
            :name,
            :drinkType,
            :defaultServings,
            :labelDisplayMode,
            :instructions,
            :isActive,
            :askStrength,
            :hasIce,
            :iceCubes,
            CASE
              WHEN :cupIngredientName IS NULL THEN NULL
              ELSE (SELECT id FROM ${TABLE_INGREDIENTS} WHERE name = :cupIngredientName)
            END,
            NOW(),
            NOW()
          )
        ON CONFLICT (name)
        DO UPDATE SET
          drink_type = EXCLUDED.drink_type,
          default_servings = EXCLUDED.default_servings,
          label_display_mode = EXCLUDED.label_display_mode,
          instructions = EXCLUDED.instructions,
          is_active = EXCLUDED.is_active,
          ask_strength = EXCLUDED.ask_strength,
          has_ice = EXCLUDED.has_ice,
          ice_cubes = EXCLUDED.ice_cubes,
          cup_ingredient_id = EXCLUDED.cup_ingredient_id,
          updated_at = NOW();`,
        {
          transaction,
          replacements: {
            name: recipe.name,
            drinkType: recipe.drinkType,
            defaultServings: recipe.defaultServings,
            labelDisplayMode: recipe.labelDisplayMode,
            instructions: recipe.instructions,
            isActive: recipe.isActive,
            askStrength: recipe.askStrength,
            hasIce: recipe.hasIce,
            iceCubes: recipe.iceCubes,
            cupIngredientName: toNullableText(recipe.cupIngredientName),
          },
        },
      );
    }

    for (const recipe of OPEN_BAR_DEV_SNAPSHOT.recipes) {
      await qi.sequelize.query(
        `
        DELETE FROM ${TABLE_RECIPE_INGREDIENTS}
        WHERE recipe_id = (SELECT id FROM ${TABLE_RECIPES} WHERE name = :recipeName);`,
        {
          transaction,
          replacements: { recipeName: recipe.name },
        },
      );
    }

    for (const line of OPEN_BAR_DEV_SNAPSHOT.recipeIngredients) {
      await qi.sequelize.query(
        `
        INSERT INTO ${TABLE_RECIPE_INGREDIENTS}
          (recipe_id, ingredient_id, category_id, line_type, quantity, sort_order, is_optional, affects_strength, is_top_up, created_at, updated_at)
        VALUES
          (
            (SELECT id FROM ${TABLE_RECIPES} WHERE name = :recipeName),
            CASE
              WHEN :lineType = 'fixed_ingredient' THEN (SELECT id FROM ${TABLE_INGREDIENTS} WHERE name = :ingredientName)
              ELSE NULL
            END,
            CASE
              WHEN :lineType = 'category_selector' THEN (SELECT id FROM ${TABLE_CATEGORIES} WHERE slug = :categorySlug)
              ELSE NULL
            END,
            :lineType,
            :quantity,
            :sortOrder,
            :isOptional,
            :affectsStrength,
            :isTopUp,
            NOW(),
            NOW()
          );`,
        {
          transaction,
          replacements: {
            recipeName: line.recipeName,
            lineType: line.lineType,
            ingredientName: toNullableText(line.ingredientName),
            categorySlug: toNullableText(line.categorySlug),
            quantity: line.quantity,
            sortOrder: line.sortOrder,
            isOptional: line.isOptional,
            affectsStrength: line.affectsStrength,
            isTopUp: line.isTopUp,
          },
        },
      );
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down(): Promise<void> {
  // Data sync migration: no automatic rollback to avoid deleting production catalog data.
}
