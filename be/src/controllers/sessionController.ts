import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest';

export const checkSession = (req: AuthenticatedRequest, res: Response) => {
    if (typeof req.user === 'object' && req.user !== null && 'id' in req.user) {
        const userId = req.user.id;
        res.json([{ authenticated: true, userId: userId }]);
    } else {
        res.status(401).json([{ authenticated: false, message: "Invalid session or user not found." }]);
    }
};