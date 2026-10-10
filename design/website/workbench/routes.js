export const routes = Object.freeze({
  "dashboard": "Shell",
  "mining": "Mining",
  "battle": "Battle",
  "dojo": "Dojo",
  "breeding": "Breeding",
  "evolve": "Evolve",
  "repair": "Repair",
  "teams": "Teams",
  "market": "Market",
  "activity": "Activity",
  "ranks": "Ranks",
  "docs": "Docs"
});

export function resolveRoute(hash) {
  const slug = hash.replace(/^#\//, "");
  return Object.hasOwn(routes, slug) ? slug : "dashboard";
}
