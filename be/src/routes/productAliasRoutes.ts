import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import * as productAliasController from '../controllers/productAliasController.js';

const router: Router = express.Router();

router.get('/', authMiddleware, productAliasController.getAllProductAliases);
router.post('/', authMiddleware, productAliasController.createProductAlias);
router.put('/:id', authMiddleware, productAliasController.updateProductAlias);
router.delete('/:id', authMiddleware, productAliasController.deleteProductAlias);

export default router;
