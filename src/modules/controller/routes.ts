import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
}));

export default router;
