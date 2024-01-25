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
    // Get the token from the header
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const token = authHeader.split(' ')[1]; // Authorization: Bearer <token>

        jwt.verify(token, process.env.JWT_SECRET || '', (err, user) => {
            if (err) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            // Forward the user info to the next middleware
            req.user = user;
            next();
        });
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

export default authenticateJWT;
