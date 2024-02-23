import express from 'express';
import authenticateJWT from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', authenticateJWT, (req, res) => {
    res.json([{authenticated: true }]);
});

export default router;