import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  STREAM_TPS_WINDOW_MS,
  slidingWindowTps,
} = await jiti.import("./message-view-utils.ts");

test("slidingWindowTps is null until min dt exists", () => {
  const samples = [];
  assert.equal(slidingWindowTps(samples, 0, 100), null);
  assert.equal(slidingWindowTps(samples, 200, 160), null);
  const rate = slidingWindowTps(samples, 300, 190);
  assert.ok(rate !== null);
  assert.equal(Math.round(rate), 300);
});

test("slidingWindowTps reports steady recent rate, not lifetime average", () => {
  const samples = [];
  let tokens = 0;
  let rate = null;
  for (let t = 0; t <= 3000; t += 300) {
    tokens += 30;
    rate = slidingWindowTps(samples, t, tokens);
  }
  assert.ok(rate !== null);
  assert.ok(Math.abs(rate - 100) < 1, `expected ~100 t/s, got ${rate}`);
});

test("slidingWindowTps forgets an early burst after the window", () => {
  const samples = [];
  slidingWindowTps(samples, 0, 2000);
  let tokens = 2000;
  let rate = null;
  for (let t = 300; t <= STREAM_TPS_WINDOW_MS + 600; t += 300) {
    tokens += 15;
    rate = slidingWindowTps(samples, t, tokens);
  }
  assert.ok(rate !== null);
  assert.ok(rate < 80, `burst should have aged out, got ${rate}`);
  assert.ok(Math.abs(rate - 50) < 5, `expected ~50 t/s, got ${rate}`);
});

test("slidingWindowTps decays toward 0 when tokens stall", () => {
  const samples = [];
  let tokens = 0;
  for (let t = 0; t <= 900; t += 300) {
    tokens += 90;
    slidingWindowTps(samples, t, tokens);
  }
  let rate = null;
  for (let t = 1200; t <= 3600; t += 300) {
    rate = slidingWindowTps(samples, t, tokens);
  }
  assert.equal(rate, 0);
});

test("slidingWindowTps ignores a reconnect snapshot dump", () => {
  const samples = [];
  assert.equal(slidingWindowTps(samples, 0, 10861), null);
  let tokens = 10861;
  let rate = null;
  for (let t = 300; t <= 2100; t += 300) {
    tokens += 12;
    rate = slidingWindowTps(samples, t, tokens);
  }
  assert.ok(rate !== null);
  assert.ok(rate < 80, `dump must not dominate the window, got ${rate}`);
});

test("slidingWindowTps resets when token count drops", () => {
  const samples = [];
  slidingWindowTps(samples, 0, 400);
  slidingWindowTps(samples, 300, 500);
  assert.equal(slidingWindowTps(samples, 600, 40), null);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].tokens, 40);
});
