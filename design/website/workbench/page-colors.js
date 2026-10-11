import { routes } from './routes.js';

// All pages share Breeding's background and matching readable text theme.
export const pageColors = Object.freeze(
  Object.fromEntries(Object.keys(routes).map(slug => [slug, '#264793']))
);
export const pageThemes = Object.freeze(
  Object.fromEntries(Object.keys(routes).map(slug => [slug, 'dark']))
);
