// 本地假服务：OpenAI chat completions / responses / Anthropic messages / images，端到端测试用。
// 用法：node tools/fake-llm.mjs [port]  (默认 8899)
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 8899);
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAATSURBVBhXY/iPA4YMmGHMgCEHRmRkAABbDANNlC9h7wAAAABJRU5ErkJggg==";

const json = (res, obj) =>
  res
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify(obj));

createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", async () => {
    const url = req.url ?? "";
    // 测试钩子：?slow=ms 让响应延迟 ms 毫秒，用于 cancel/超时用例
    const slow = Number(new URL(url, "http://x").searchParams.get("slow") ?? 0)
      || (url.includes("/slow/") ? 6000 : 0);
    if (slow > 0) {
      await new Promise((r) => setTimeout(r, slow));
      if (req.destroyed || res.writableEnded) return;
    }
    let json_body = {};
    try {
      json_body = JSON.parse(body || "{}");
    } catch {
      /* ignore */
    }
    const model = json_body.model ?? "fake";
    const reply = "ok";
    const wantStream = !!json_body.stream;

    // --- OpenAI Chat Completions ---
    if (url.includes("/chat/completions")) {
      if (wantStream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunks = [
          {
            id: "c1",
            object: "chat.completion.chunk",
            created: 0,
            model,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: reply },
                finish_reason: null,
              },
            ],
          },
          {
            id: "c1",
            object: "chat.completion.chunk",
            created: 0,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          },
        ];
        for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      return json(res, {
        id: "c1",
        object: "chat.completion",
        created: 0,
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      });
    }

    // --- OpenAI Responses ---
    if (url.includes("/responses")) {
      if (wantStream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const ev = [
          {
            type: "response.created",
            response: {
              id: "r1",
              object: "response",
              model,
              status: "in_progress",
              output: [],
            },
          },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: {
              type: "message",
              id: "m1",
              role: "assistant",
              status: "in_progress",
              content: [],
            },
          },
          {
            type: "response.content_part.added",
            item_id: "m1",
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "" },
          },
          {
            type: "response.output_text.delta",
            item_id: "m1",
            output_index: 0,
            content_index: 0,
            delta: reply,
          },
          {
            type: "response.output_text.done",
            item_id: "m1",
            output_index: 0,
            content_index: 0,
            text: reply,
          },
          {
            type: "response.content_part.done",
            item_id: "m1",
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: reply },
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "message",
              id: "m1",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: reply }],
            },
          },
          {
            type: "response.completed",
            response: {
              id: "r1",
              object: "response",
              model,
              status: "completed",
              output: [
                {
                  type: "message",
                  id: "m1",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text: reply }],
                },
              ],
              usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
            },
          },
        ];
        for (const e of ev)
          res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
        return res.end();
      }
      return json(res, {
        id: "r1",
        object: "response",
        model,
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: reply }],
          },
        ],
        usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
      });
    }

    // --- Anthropic Messages ---
    if (url.includes("/messages")) {
      if (wantStream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const ev = [
          [
            "message_start",
            {
              type: "message_start",
              message: {
                id: "m1",
                type: "message",
                role: "assistant",
                model,
                content: [],
                usage: { input_tokens: 5, output_tokens: 1 },
              },
            },
          ],
          [
            "content_block_start",
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
          ],
          [
            "content_block_delta",
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: reply },
            },
          ],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          [
            "message_delta",
            {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
              usage: { output_tokens: 1 },
            },
          ],
          ["message_stop", { type: "message_stop" }],
        ];
        for (const [t, e] of ev)
          res.write(`event: ${t}\ndata: ${JSON.stringify(e)}\n\n`);
        return res.end();
      }
      return json(res, {
        id: "m1",
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: reply }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 1 },
      });
    }

    // --- Images ---
    if (url.includes("/images")) {
      return json(res, { created: 0, data: [{ b64_json: PNG_B64 }] });
    }
    res.writeHead(404).end("no route " + url);
  });
}).listen(PORT, () => console.log(`fake-llm on :${PORT}`));
