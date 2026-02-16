import { Hono } from 'hono';

export const marketRoutes = new Hono();

// GET /api/game/market/listings — browse active listings
marketRoutes.get('/listings', (c) => {
  const classFilter = c.req.query('class');
  const tier = c.req.query('tier');
  const minPurity = c.req.query('minPurity');
  const maxPrice = c.req.query('maxPrice');
  const minPrice = c.req.query('minPrice');
  const legend = c.req.query('legend');
  const sort = c.req.query('sort') ?? 'recent';
  const limit = c.req.query('limit') ?? '20';
  const offset = c.req.query('offset') ?? '0';
  return c.json({
    todo: true,
    endpoint: 'list-listings',
    filters: { class: classFilter, tier, minPurity, minPrice, maxPrice, legend, sort, limit, offset },
  });
});

// GET /api/game/market/listings/:listingId — get listing details
marketRoutes.get('/listings/:listingId', (c) => {
  const { listingId } = c.req.param();
  return c.json({ todo: true, endpoint: 'get-listing', listingId });
});

// POST /api/game/market/list — list a lobster for sale
marketRoutes.post('/list', async (c) => {
  const body = await c.req.json();
  // body: { lobsterId, price }
  return c.json({ todo: true, endpoint: 'list-lobster', ...body });
});

// POST /api/game/market/listings/:listingId/buy — buy a listing
marketRoutes.post('/listings/:listingId/buy', (c) => {
  const { listingId } = c.req.param();
  return c.json({ todo: true, endpoint: 'buy-lobster', listingId });
});

// DELETE /api/game/market/listings/:listingId — cancel a listing
marketRoutes.delete('/listings/:listingId', (c) => {
  const { listingId } = c.req.param();
  return c.json({ todo: true, endpoint: 'cancel-listing', listingId });
});

// PATCH /api/game/market/listings/:listingId/price — update listing price
marketRoutes.patch('/listings/:listingId/price', async (c) => {
  const { listingId } = c.req.param();
  const body = await c.req.json();
  // body: { price }
  return c.json({ todo: true, endpoint: 'update-price', listingId, ...body });
});

// GET /api/game/market/price-history/:lobsterId — price history for a lobster
marketRoutes.get('/price-history/:lobsterId', (c) => {
  const { lobsterId } = c.req.param();
  return c.json({ todo: true, endpoint: 'price-history', lobsterId });
});
