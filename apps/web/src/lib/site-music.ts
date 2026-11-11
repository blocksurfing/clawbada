/**
 * The site theme's on/off logic, shared by both music buttons (components/music-toggle.tsx) — free of the DOM, so it
 * can be tested.
 *
 * The stored preference (audio-prefs.ts) says what the visitor WANTS; it is not what they hear. A browser that has
 * never stored one reads as "on", and a stored "on" is refused by most browsers until the visitor has interacted with
 * the page — in both cases nothing is playing. So the buttons show, and a press reverses, what is actually the case:
 * the theme is on when it is wanted AND it is either playing or only silenced for a battle and due back after it.
 * (Until 2026-11-11 a press reversed the stored preference: on a new browser the first press turned "on" into "off"
 * in silence, and it took a second one to hear anything.)
 */
export function siteMusicOn(wanted: boolean, playing: boolean, dueBack: boolean): boolean {
  return wanted && (playing || dueBack);
}

export type MusicPress = 'stop' | 'start' | 'start-after-battle';
/** What a press on a music button does. Inside a battle view the theme never starts: it comes in when the battle is over. */
export function musicPress(on: boolean, inBattle: boolean): MusicPress {
  return on ? 'stop' : inBattle ? 'start-after-battle' : 'start';
}
