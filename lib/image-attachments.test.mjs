import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./image-attachments.ts");
}

const image = { type: "image", mimeType: "image/png", data: "YWJj" };

test("calculates padded base64 byte lengths and rejects invalid data", async () => {
  const { getBase64DecodedByteLength } = await loadSubject();

  assert.equal(getBase64DecodedByteLength("YQ=="), 1);
  assert.equal(getBase64DecodedByteLength("YWI="), 2);
  assert.equal(getBase64DecodedByteLength("YWJj"), 3);
  assert.equal(getBase64DecodedByteLength("not base64!"), null);
});

test("rejects invalid, oversized, and too many image attachments", async () => {
  const { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES, validateAgentImages } = await loadSubject();
  const oversizedData = "AAAA".repeat(Math.ceil((MAX_ATTACHED_IMAGE_BYTES + 1) / 3));

  assert.equal(validateAgentImages([image]), null);
  assert.match(validateAgentImages([{ ...image, mimeType: "text/plain" }]), /valid base64 image/);
  assert.match(validateAgentImages([{ ...image, data: oversizedData }]), /10MB/);
  assert.match(validateAgentImages(Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, () => image)), /at most/);
});

test("extracts nested and flat image blocks from message content", async () => {
  const { extractBase64ImagesFromContent } = await loadSubject();
  assert.deepEqual(
    extractBase64ImagesFromContent([
      { type: "text", text: "see" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
      { type: "image", data: "YWJj", mimeType: "image/jpeg" },
      { type: "image", source: { type: "url", url: "https://example.com/x.png" } },
    ]),
    [
      { data: "AQID", mimeType: "image/png" },
      { data: "YWJj", mimeType: "image/jpeg" },
    ],
  );
});

test("peeks undelivered images from agent-core queues", async () => {
  const { peekAgentQueueImages } = await loadSubject();
  const agent = {
    steeringQueue: {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "steer" },
            { type: "image", data: "YWJj", mimeType: "image/png" },
          ],
        },
      ],
    },
    followUpQueue: {
      messages: [
        { role: "user", content: [{ type: "image", data: "AQID", mimeType: "image/webp" }] },
      ],
    },
  };
  assert.deepEqual(peekAgentQueueImages(agent), {
    steering: [{ data: "YWJj", mimeType: "image/png" }],
    followUp: [{ data: "AQID", mimeType: "image/webp" }],
  });
  assert.deepEqual(peekAgentQueueImages(null), { steering: [], followUp: [] });
  assert.deepEqual(peekAgentQueueImages({}), { steering: [], followUp: [] });
});

test("flattens steer then follow-up text and images for composer restore", async () => {
  const { flattenQueueRecall } = await loadSubject();
  assert.deepEqual(
    flattenQueueRecall({
      steering: ["steer me"],
      followUp: ["", "later"],
      steeringImages: [{ data: "YWJj", mimeType: "image/png" }],
      followUpImages: [{ data: "AQID", mimeType: "image/jpeg" }],
    }),
    {
      text: "steer me\n\nlater",
      images: [
        { data: "YWJj", mimeType: "image/png" },
        { data: "AQID", mimeType: "image/jpeg" },
      ],
    },
  );
  assert.deepEqual(flattenQueueRecall({ steering: ["  "], followUp: [] }), { text: "", images: [] });
});
