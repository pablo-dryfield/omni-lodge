import { Request, Response, Router } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({
    status: 'ok',
    ready: true,
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

export default router;
