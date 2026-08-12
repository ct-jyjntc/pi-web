import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  canRestoreUserMessage,
  getUserMessageDraftImages,
  getUserMessageText,
  prependAttachedImages,
} = await jiti.import("./chat-input-shared.ts");

test("restores text and base64 images when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Review this image @src/example.ts " },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
  };

  assert.equal(getUserMessageText(message), "Review this image @src/example.ts ");
  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/png" },
  ]);
});

test("restores legacy flat image entries when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "AQID", mimeType: "image/jpeg" },
    ],
  };

  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/jpeg" },
  ]);
});

test("does not restore a historical message over a pending image attachment", () => {
  assert.equal(canRestoreUserMessage("", 0, 0), true);
  assert.equal(canRestoreUserMessage("", 1, 0), false);
  assert.equal(canRestoreUserMessage("", 0, 1), false);
  assert.equal(canRestoreUserMessage("draft", 0, 0), false);
});

test("prepends recalled images in front of existing composer attachments", () => {
  const current = [{ data: "YWJj", mimeType: "image/png", previewUrl: "data:image/png;base64,YWJj" }];
  const next = prependAttachedImages(current, [{ data: "AQID", mimeType: "image/jpeg" }]);
  assert.equal(next[0]?.data, "AQID");
  assert.equal(next[1]?.data, "YWJj");
  assert.equal(next.length, 2);
});
