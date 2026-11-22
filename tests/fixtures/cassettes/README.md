# M0 W3 Settings recordings

Use `NL_REPLAY=strict NL_CASSETTE_DIR="$PWD/tests/fixtures/cassettes" pnpm dev`
from the repository root. Use `https://relay.invalid` as the base URL for
Anthropic Messages and `https://relay.invalid/v1` for both OpenAI formats and
images. Use a nonempty placeholder API key.

| Case | Settings configuration |
| --- | --- |
| `messages` | Fast: Anthropic Messages, `deepseek-v4.1-flash`, context window `1000000` |
| `responses` | Main: OpenAI Responses, `devin-swe-2`, context window `256000` |
| `chat-vision` | Visual: OpenAI Chat Completions, `gemini-3.8-flash`, context window `1000000` |
| `generate`, `transparent`, `edit` | Image: `gpt-image-2.6-sunburst`, high quality, 1536 native long edge |
| `auth` | Writing: OpenAI Chat Completions, `gemini-3.8-flash`, context window `1000000` (no image attachment) |
| `moderation` | Visual: OpenAI Chat Completions, `fixture-moderation`, context window `1000000` |

Turn off fast-slot inheritance for independently configured slots and use the
automatic compatibility preset. The `auth` case replays a real 401 made with an
intentionally wrong key. Use the Writing slot so its text-only request has a
different replay key from the image-bearing success. Enter the context window
after the model name. In particular, `fixture-moderation` is not a catalog model
and has no automatic context window. Its response is synthetic: the live check
returned without a moderation block.

The current vision smoke entry reuses the same live response as `chat-vision`.
