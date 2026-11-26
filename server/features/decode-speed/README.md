# Decode speed

Measures how fast the model writes each assistant reply, in tokens per second, for the response bar under every reply.

Pi stores only `durationMs` for a request, which includes reading the prompt, so the speed comes from two sources, in this order:

1. **The model server's own measurement.** When a reply ends, `engineDecodeSpeed` looks up the reply's provider in Pi's `models.json` and reads `/v1/status` from its base URL, only when that URL names this machine (`127.0.0.1`, `localhost`, or `[::1]`), so cloud providers never receive extra requests. PolyStrata and Strata report the last request there in llama.cpp's names; `last_timings.predicted_per_second` is used only when `predicted_n` equals the reply's output tokens, so another request that finished in between is never attributed to it.
2. **Stream timing.** For servers without that endpoint, `DecodeSpeedTracker` watches the live stream `server/backend.ts` receives from the manager: the first `text_delta`, `thinking_delta`, or `toolcall_delta` marks the first generated token, and `message_end` closes the span. The speed is the output tokens after the first one divided by that span.

The backend processes manager events through one ordered queue, so the short `/v1/status` lookup never lets later events overtake a reply's `message_end`.

The backend adds the measurement to the `message_end` event as `message.decodeTokensPerSecond` before broadcasting it, and `DecodeSpeedStore` persists it in `~/.pi-livecraft/decode-speeds.json` (override with `PI_LIVECRAFT_DECODE_SPEED_STORE`), keyed by the reply's `responseId` or timestamp. Session snapshots add the stored speeds back to assistant messages. Replies written while no backend was running, or before this feature, have no speed.

Focused coverage: `test/decode-speed.test.ts`.
