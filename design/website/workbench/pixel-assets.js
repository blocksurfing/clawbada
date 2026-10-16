// Register each new PNG once. URLs are bundled by Vite and watched in dev.
// Scale comes exclusively from CSS --pixel; do not add per-asset scales.
export const pixelAssets = Object.freeze({
  marketBase: {
    kind: 'sprite',
    src: new URL('./assets/market/Base/Sheet.png', import.meta.url).href,
    width: 640, height: 64, frame: [64, 64],
  },
  marketEvolved: {
    kind: 'sprite',
    src: new URL('./assets/market/Evolved/Sheet.png', import.meta.url).href,
    width: 640, height: 64, frame: [64, 64],
  },
  marketElite: {
    kind: 'sprite',
    src: new URL('./assets/market/Elite/Sheet.png', import.meta.url).href,
    width: 640, height: 64, frame: [64, 64],
  },
  marketApex: {
    kind: 'sprite',
    src: new URL('./assets/market/Apex/Sheet.png', import.meta.url).href,
    width: 640, height: 64, frame: [64, 64],
  },
  marketPurity: {
    kind: 'sprite',
    src: new URL('../site/Marketplace/Sprite/Tileset.png', import.meta.url).href,
    width: 208, height: 128, frame: [16, 16],
  },
  marketBreed: {
    kind: 'sprite',
    src: new URL('../site/Marketplace/Sprite/Tileset.png', import.meta.url).href,
    width: 208, height: 128, frame: [16, 16],
  },
  marketDivider: {
    kind: 'panel',
    src: new URL('../site/Marketplace/Sprite/Tileset.png', import.meta.url).href,
    width:208, height:128, region:[96,64,96,16], tile:16, sliceSpan:32, horizontal:true,
  },
  marketPriceLabel: {
    kind: 'panel',
    src: new URL('../site/Marketplace/Sprite/Tileset.png', import.meta.url).href,
    width: 208, height: 128, region: [0, 96, 48, 32], tile: 16, horizontal: true,
  },
  marketBidButton: {
    kind: 'panel',
    src: new URL('../site/Marketplace/Sprite/Tileset.png', import.meta.url).href,
    width: 208, height: 128, region: [48, 96, 48, 32], tile: 16, horizontal: true,
  },
  marketIdentity: {
    kind: 'panel',
    src: new URL('../site/Marketplace/Sprite/Tileset.png', import.meta.url).href,
    width: 208, height: 128, region: [0, 48, 48, 48], tile: 16,
    identityJoins: [64, 64, 16, 16],
  },
  marketCard: {
    kind: 'panel',
    src: new URL('../site/Marketplace/Sprite/Tileset.png', import.meta.url).href,
    width: 208, height: 128, region: [0, 0, 96, 96], tile: 16, sliceSpan: 32,
  },
  marketEgg: {
    kind: 'sprite',
    src: new URL('../site/Marketplace/Sprite/Egg.png', import.meta.url).href,
    width: 192, height: 32, frame: [32, 32],
  },
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
