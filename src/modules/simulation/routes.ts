import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, message: 'Simulation endpoints placeholder' });
}));

export default router;
