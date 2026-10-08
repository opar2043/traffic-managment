import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { normalizeConfig } from '../../domain/junctionConfig';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const junctions = await prisma.junction.findMany();
  res.json({ success: true, data: junctions });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const j = await prisma.junction.findUnique({ where: { id: req.params.id } });
  if (!j) throw new AppError('Junction not found', 404);
  res.json({ success: true, data: j });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { id, name, config } = req.body;
  if (!id) throw new AppError('id required', 400);
  const j = await prisma.junction.create({
    data: {
      id: String(id),
      name: name || String(id),
      config: normalizeConfig(config) as any,
      mode: 'AUTOMATIC',
      phase: 'ALL_RED',
      desiredSignals: { NORTH: 'RED', SOUTH: 'RED', EAST: 'RED', WEST: 'RED' },
      actualSignals: { NORTH: 'RED', SOUTH: 'RED', EAST: 'RED', WEST: 'RED' },
      controllerStatus: 'UNKNOWN',
    },
  });
  res.status(201).json({ success: true, data: j });
}));

export default router;
