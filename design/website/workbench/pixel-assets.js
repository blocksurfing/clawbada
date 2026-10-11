// Register each new PNG once. URLs are bundled by Vite and watched in dev.
// Scale comes exclusively from CSS --pixel; do not add per-asset scales.
export const pixelAssets = Object.freeze({
  shellBackgroundRock2: {
    kind: 'sprite',
    src: new URL('../site/The Shell/Background_Rock_2.png', import.meta.url).href,
    width: 640, height: 360, frame: [640, 360],
  },
  shellBackgroundRock: {
    kind: 'sprite',
    src: new URL('../site/The Shell/Background_Rock.png', import.meta.url).href,
    width: 640, height: 360, frame: [640, 360],
  },
  shellCoral: {
    kind: 'sprite',
    src: new URL('../site/The Shell/Coral.png', import.meta.url).href,
    width: 640, height: 360, frame: [640, 360],
  },
  shellBackSand: {
    kind: 'sprite',
    src: new URL('../site/The Shell/Back_Sand.png', import.meta.url).href,
    width: 640, height: 360, frame: [640, 360],
  },
  shellRoom: {
    kind: 'sprite',
    src: new URL('../site/The Shell/Shell.png', import.meta.url).href,
    width: 640, height: 360, frame: [640, 360],
  },
  shellSand: {
    kind: 'sprite',
    src: new URL('../site/The Shell/Sand.png', import.meta.url).href,
    width: 640, height: 360, frame: [640, 360],
  },
  shellSeaweed1: {
    kind: 'sprite',
    src: new URL('../../../packages/battle-engine/ClawbadaBattle/Assets/Art/Arenas/Elite/Decoration/Foreground Seaweed/FG_Seaweed_1.png', import.meta.url).href,
    width: 384, height: 48, frame: [64, 48],
  },
  shellSeaweed2: {
    kind: 'sprite',
    src: new URL('../../../packages/battle-engine/ClawbadaBattle/Assets/Art/Arenas/Elite/Decoration/Foreground Seaweed/FG_Seaweed_2.png', import.meta.url).href,
    width: 384, height: 48, frame: [64, 48],
  },
  classBadges: {
    kind: 'sprite',
    src: new URL('../../../packages/battle-engine/ClawbadaBattle/Assets/Art/UI/Avatar/ClassBadge.png', import.meta.url).href,
    width: 160, height: 16, frame: [16, 16],
  },
  apexClassSheet: {
    kind: 'sprite',
    src: new URL('./assets/apex-class-sheet.png', import.meta.url).href,
    width: 640, height: 64, frame: [64, 64],
  },
  characterStageSelect: {
    kind: 'sprite',
    src: new URL('../site/The Shell/Character_Stage_Select.png', import.meta.url).href,
    width: 640, height: 360, frame: [640, 360],
    region: [240, 205, 148, 75],
  },
  characterStage: {
    kind: 'sprite',
    src: new URL('../site/The Shell/Character_Stage.png', import.meta.url).href,
    width: 640, height: 360, frame: [640, 360],
    region: [242, 206, 144, 72],
  },
  shellRock: {
    kind: 'sprite',
    src: new URL('../site/The Shell/Rock.png', import.meta.url).href,
    width: 640, height: 360, frame: [640, 360],
  },
  woodenPanel: {
    kind: 'panel',
    src: new URL('../site/Tileset/WoodenPanel.png', import.meta.url).href,
    width: 192, height: 192,
    region: [0, 0, 48, 48], tile: 16,
  },
  menuIcons: {
    kind: 'sprite',
    src: new URL('../site/sidebar/Icons.png', import.meta.url).href,
    width: 192, height: 16, frame: [16, 16],
  },
});
