import { LobsterClass } from './types';

export const CLASS_NAMES: Record<LobsterClass, string> = {
  [LobsterClass.Bulwark]: 'Bulwark',
  [LobsterClass.Mantis]: 'Mantis',
  [LobsterClass.Leviathan]: 'Leviathan',
  [LobsterClass.Tempest]: 'Tempest',
  [LobsterClass.Specter]: 'Specter',
  [LobsterClass.Sentinel]: 'Sentinel',
  [LobsterClass.Reaver]: 'Reaver',
  [LobsterClass.Abyss]: 'Abyss',
  [LobsterClass.Kraken]: 'Kraken',
  [LobsterClass.Ember]: 'Ember',
};

/** Array form of CLASS_NAMES for iteration (index = LobsterClass enum value). */
export const CLASS_NAMES_LIST: readonly string[] = Array.from({ length: 10 }, (_, i) => CLASS_NAMES[i as LobsterClass]);

export const CLASS_ROLES: Record<LobsterClass, string> = {
  [LobsterClass.Bulwark]: 'Tank',
  [LobsterClass.Mantis]: 'Assassin',
  [LobsterClass.Leviathan]: 'Bruiser',
  [LobsterClass.Tempest]: 'Nuker',
  [LobsterClass.Specter]: 'Debuffer',
  [LobsterClass.Sentinel]: 'Support',
  [LobsterClass.Reaver]: 'DPS',
  [LobsterClass.Abyss]: 'Lifesteal',
  [LobsterClass.Kraken]: 'Controller',
  [LobsterClass.Ember]: 'Glass Cannon',
};

export const CLASS_SPECIAL_NAMES: Record<LobsterClass, string> = {
  [LobsterClass.Bulwark]: 'Fortify',
  [LobsterClass.Mantis]: 'Ambush',
  [LobsterClass.Leviathan]: 'Crush',
  [LobsterClass.Tempest]: 'Maelstrom',
  [LobsterClass.Specter]: 'Haunt',
  [LobsterClass.Sentinel]: 'Rally',
  [LobsterClass.Reaver]: 'Rend',
  [LobsterClass.Abyss]: 'Devour',
  [LobsterClass.Kraken]: 'Bind',
  [LobsterClass.Ember]: 'Inferno',
};

export const BODY_PART_NAMES = [
  'Carapace',
  'Claws',
  'Tail',
  'Antennae',
  'Eyes',
  'Legs',
] as const;

export const BODY_PART_STATS = [
  'HP',
  'Attack',
  'Speed',
  'Critical',
  'Armor',
  'HP',
] as const;

/**
 * Class advantage graph — circulant design.
 * Each class beats the next 4 classes (mod 10) and loses to the previous 4.
 * CLASS_ADVANTAGE_GRAPH[attacker] = Set of classes the attacker beats.
 */
export const CLASS_ADVANTAGE_GRAPH: Record<LobsterClass, Set<LobsterClass>> = (() => {
  const graph = {} as Record<LobsterClass, Set<LobsterClass>>;
  for (let i = 0; i < 10; i++) {
    const beats = new Set<LobsterClass>();
    for (let j = 1; j <= 4; j++) {
      beats.add(((i + j) % 10) as LobsterClass);
    }
    graph[i as LobsterClass] = beats;
  }
  return graph;
})();
