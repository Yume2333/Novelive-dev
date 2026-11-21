import OpenAI, {
  toFile,
} from "./node_modules/.pnpm/openai@7.62.0/node_modules/openai/index.mjs";
import { Cassette } from "./tests/cassette.mjs";

const cas = new Cassette("tests/fixtures/image-real.jsonl", "record", {
  case: "image-model-test",
});
const client = new OpenAI({
  apiKey: process.env.NL_IMAGE_API_KEY,
  baseURL: process.env.NL_IMAGE_BASE_URL,
  maxRetries: 0,
  timeout: 300_000,
  fetch: cas.fetch(),
});
const out = {};
// 1) t2i
try {
  const r = await client.images.generate({
    model: process.env.NL_IMAGE_MODEL,
    prompt: "A small red cube on a white background, product photo",
    size: "1024x1024",
    n: 1,
  });
  out.t2i = { ok: true, len: r.data?.[0]?.b64_json?.length ?? 0 };
} catch (e) {
  out.t2i = { err: String(e).slice(0, 200) };
}
// 2) transparent
try {
  const r = await client.images.generate({
    model: process.env.NL_IMAGE_MODEL,
    prompt: "A single green leaf, isolated object",
    size: "1024x1024",
    n: 1,
    background: "transparent",
  });
  const b64 = r.data?.[0]?.b64_json ?? "";
  const buf = Buffer.from(b64, "base64");
  out.transparent = {
    ok: true,
    len: b64.length,
    alpha: buf.length > 25 ? buf[25] === 4 || buf[25] === 6 : null,
  };
} catch (e) {
  out.transparent = { err: String(e).slice(0, 200) };
}
// 3) edit
try {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAATSURBVBhXY/iPA4YMmGHMgCEHRmRkAABbDANNlC9h7wAAAABJRU5ErkJggg==",
    "base64",
  );
  const file = await toFile(PNG, "input.png", { type: "image/png" });
  const r = await client.images.edit({
    model: process.env.NL_IMAGE_MODEL,
    image: file,
    prompt: "Make it blue",
    size: "1024x1024",
    n: 1,
  });
  out.edit = { ok: true, len: r.data?.[0]?.b64_json?.length ?? 0 };
} catch (e) {
  out.edit = { err: String(e).slice(0, 200) };
}
console.log(JSON.stringify(out));
