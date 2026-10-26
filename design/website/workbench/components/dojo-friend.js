// Local UI fixtures only: no room service, network connection or matchmaking.
const codePattern = /^DEMO-[A-Z0-9]{6}$/;
export function createDemoRoom() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `DEMO-${Array.from(bytes, byte => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[byte % 36]).join('')}`;
}
export function parseDemoRoom(input, base) {
  const value = input.trim();
  if (codePattern.test(value.toUpperCase())) return value.toUpperCase();
  try {
    const url = new URL(value);
    const local = new URL(base);
    const code = url.searchParams.get('dojoRoom');
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== local.origin || url.pathname !== local.pathname || url.username || url.password || url.hash !== '#/dojo' || url.searchParams.getAll('dojoRoom').length !== 1) return null;
    return codePattern.test(code) ? code : null;
  } catch { return null; }
}
export function demoRoomLink(code, base) {
  const url = new URL(base);
  url.search = '';
  url.searchParams.set('dojoRoom', code);
  url.hash = '/dojo';
  return url.href;
}
