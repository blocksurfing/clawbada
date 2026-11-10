/**
 * The largest request body the server reads. Every body this API takes is a few hundred bytes of JSON (a turn, a
 * team, an id or two); Bun's default is 128 MB, read in full and parsed before a handler can refuse it — and dense
 * JSON takes many times its size in memory once parsed. Past the limit Bun answers 413 without buffering the body.
 * WebSocket frames have their own cap (4 KB, index.ts).
 */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;
