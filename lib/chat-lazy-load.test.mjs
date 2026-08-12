import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./chat-lazy-load.ts");
}

test("shows only the last visible render items", async () => {
  const { getVisibleRenderWindow } = await loadSubject();
  assert.deepEqual(getVisibleRenderWindow(200, 50), { startIndex: 150, hasMore: true });
});

test("shows all render items when the visible count reaches the total", async () => {
  const { getVisibleRenderWindow } = await loadSubject();
  assert.deepEqual(getVisibleRenderWindow(30, 50), { startIndex: 0, hasMore: false });
  assert.deepEqual(getVisibleRenderWindow(50, 50), { startIndex: 0, hasMore: false });
  assert.deepEqual(getVisibleRenderWindow(0, 50), { startIndex: 0, hasMore: false });
});

test("continues paging when render items outnumber source messages", async () => {
  const { getNextVisibleCount, getVisibleRenderWindow } = await loadSubject();
  let visibleCount = 50;

  visibleCount = getNextVisibleCount(visibleCount);
  assert.deepEqual(getVisibleRenderWindow(120, visibleCount), { startIndex: 20, hasMore: true });

  visibleCount = getNextVisibleCount(visibleCount);
  assert.deepEqual(getVisibleRenderWindow(120, visibleCount), { startIndex: 0, hasMore: false });
});

test("restores the viewport after prepending content", async () => {
  const { captureScrollDistance, restoreScrollTop } = await loadSubject();
  const savedDistance = captureScrollDistance(2000, 500);

  assert.equal(savedDistance, 1500);
  assert.equal(restoreScrollTop(2500, savedDistance), 1000);
});

test("restores top and bottom boundary positions", async () => {
  const { captureScrollDistance, restoreScrollTop } = await loadSubject();
  assert.equal(restoreScrollTop(3000, captureScrollDistance(2000, 0)), 1000);
  assert.equal(restoreScrollTop(3000, captureScrollDistance(2000, 2000)), 3000);
});

test("pages when the transcript does not overflow", async () => {
  const { shouldPageEarlierMessages } = await loadSubject();
  assert.equal(shouldPageEarlierMessages({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 }), true);
  assert.equal(shouldPageEarlierMessages({ scrollTop: 0, scrollHeight: 401, clientHeight: 400 }), true);
});

test("pages when scrolled to the top of an overflowing transcript", async () => {
  const { shouldPageEarlierMessages } = await loadSubject();
  assert.equal(shouldPageEarlierMessages({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400 }), true);
  assert.equal(shouldPageEarlierMessages({ scrollTop: 8, scrollHeight: 2000, clientHeight: 400 }), true);
});

test("does not page in the middle or at the bottom", async () => {
  const { shouldPageEarlierMessages } = await loadSubject();
  assert.equal(shouldPageEarlierMessages({ scrollTop: 9, scrollHeight: 2000, clientHeight: 400 }), false);
  assert.equal(shouldPageEarlierMessages({ scrollTop: 1600, scrollHeight: 2000, clientHeight: 400 }), false);
});

test("does not page when the viewport has no height yet", async () => {
  const { shouldPageEarlierMessages } = await loadSubject();
  assert.equal(shouldPageEarlierMessages({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 }), false);
});
