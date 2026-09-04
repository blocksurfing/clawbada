import { Hono } from 'hono';
import { miningRoutes } from './mining';
import { combatRoutes } from './combat';
import { breedingRoutes } from './breeding';
import { teamRoutes } from './teams';
import { marketRoutes } from './market';
import { evolutionRoutes } from './evolution';
import { repairRoutes } from './repair';
import { renderRoutes } from './render';
import { boostRoutes } from './boost';

export const gameRoutes = new Hono();

gameRoutes.route('/mining', miningRoutes);
gameRoutes.route('/combat', combatRoutes);
gameRoutes.route('/breeding', breedingRoutes);
gameRoutes.route('/teams', teamRoutes);
gameRoutes.route('/market', marketRoutes);
gameRoutes.route('/evolution', evolutionRoutes);
gameRoutes.route('/repair', repairRoutes);
gameRoutes.route('/render', renderRoutes);
// Battle-rank mining boost reads (public, no walletAuth).
gameRoutes.route('/boost', boostRoutes);
