import express from 'express';
import cors from 'cors';
import { notFound } from './middlewares/notFound';
import { errorHandler } from './middlewares/errorHandler';
import junctionRoutes from './modules/junction/routes';
import sensorEventRoutes from './modules/sensor-event/routes';
import commandRoutes from './modules/command/routes';
import controllerEventRoutes from './modules/controller-event/routes';
import historyRoutes from './modules/history/routes';
import healthRoutes from './modules/health/routes';
import simulationRoutes from './modules/simulation/routes';
import deviceStatusRoutes from './modules/device-status/routes';
import controllerRoutes from './modules/controller/routes';
import statusRoutes from './modules/status/routes';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/health', healthRoutes);
app.use('/api/junctions', junctionRoutes);
app.use('/api/sensor-events', sensorEventRoutes);
app.use('/api', commandRoutes); // /api/junctions/:id/commands
app.use('/api/controller-events', controllerEventRoutes);
app.use('/api/device-status', deviceStatusRoutes);
app.use('/api/controller', controllerRoutes);
app.use('/api/junctions', statusRoutes);
app.use('/api/junctions', historyRoutes); // /api/junctions/:id/history, /api/junctions/:id/queues
app.use('/api/simulation', simulationRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
