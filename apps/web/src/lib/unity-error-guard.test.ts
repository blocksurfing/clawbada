import { describe, expect, test } from 'bun:test';
import { isUnityError } from './unity-error-guard';

describe('isUnityError', () => {
  test("Unity's own errors reach Unity", () => {
    expect(isUnityError('RuntimeError: unreachable\n    at wasm://wasm/0a1b2c3d:wasm-function[123]:0x4567')).toBe(true);
    expect(isUnityError('TypeError: x is null\n    at _JS_Sound_Load (blob:https://clawbada.com/5b2e-…:3:1200)')).toBe(true);
    expect(isUnityError('https://clawbada.com/unity-build/Build/unity-build.loader.js')).toBe(true);
  });
  test('the page’s other errors are kept from its alert', () => {
    expect(isUnityError('Error: Family Accounts is not connected.\n    at et.requireConnectedSdk (https://clawbada.com/_next/static/chunks/4ff20d36.js:1:200)')).toBe(false);
    expect(isUnityError('chrome-extension://bfnaelmomeimhlpmgjnjophhpkkoljpa/inpage.js')).toBe(false);
    expect(isUnityError('')).toBe(false);
  });
});
