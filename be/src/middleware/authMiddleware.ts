import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Extending the Express Request type to include the user property
interface AuthenticatedRequest extends Request {
    user?: string | JwtPayload;
}

const authenticateJWT = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const token = req.cookies['token'];
    if (token) {
        jwt.verify(token, process.env.JWT_SECRET || '', (err: Error | null, decoded: string | jwt.JwtPayload | undefined) => {
            if (err) {
                return res.status(403).json({ error: 'Forbidden, invalid or expired token' });
            }

            req.user = decoded;
            next();
        });
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

export default authenticateJWT;
