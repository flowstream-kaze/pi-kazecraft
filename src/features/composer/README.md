# Composer

Follow the [step-by-step guide](/docs/HOW-TO-COMPOSER.md) to add a button,
dropdown, or stat. Return here for the data flow and internal state reference below.

## Data flow

`App.tsx` → props → `Composer.tsx` → `onSend()` / `onCommand()` / `onBuiltinCommand()` /
`onAbort()` → `src/api.ts` → backend or Pi

All data arrives through props. The Composer never calls the backend directly.

## Sub-modules

| Module | Purpose |
|---|---|
| `Composer.tsx` | Form, textarea, images, slash-commands, send/stop, assembly |
| `composer.css` | All composer styles |
| `composer-images.ts` | Image paste, resize, compress (`maxComposerImages` = 4) |
| `../../../shared/attachments.ts` | What the **+** attach button accepts, safe upload names, and the "Attached files:" lines added to the message |
| `composer-utils.ts` | Label/token formatting, Pi command detection, draft loading, `isObject` |
| `builtin-commands.ts` | Pi's built-in terminal commands (`/model`, `/name`, `/reload`, …): slash-menu entries and parsing. Pi rejects them over RPC, so `App.tsx` (`handleBuiltinCommand`) runs each through an RPC command or the app's own UI; a Pi command with the same name wins. |
| `prompt-title.ts` | Immediate session title, replaced later by Pi's extension title |
| `selects/ComposerSelect.tsx` | Generic Radix Select wrapper with tone-based icons |
| `selects/AgentSelect.tsx` | Agent picker — derives label from options, calls `onAgentChange` |
| `selects/ModelSelect.tsx` | Model picker — builds RPC `set_model` command from selection |
| `selects/ThinkingSelect.tsx` | Thinking level — maps level to `set_thinking_level` RPC |
| `selects/BehaviorSelect.tsx` | Steer / Follow-up toggle, only rendered while Pi is running |
| `selects/VoiceSelect.tsx` | Picks the Read Aloud voice across chats, effective on the next playback |
| `ContextChip.tsx` | Context usage: a toolbar chip whose background fills like a gauge and warms at 50, 70, and 85 percent |

The session name and folder live in the [session top bar](/src/features/top-bar/README.md). Pi's prompt
templates stay available as `/name` commands in the slash menu.

The composer shares the message column's width: its side margins use `--thread-inline` and
`--thread-scrollbar` from `conversation.css`, the same values as the conversation's padding.

## Internal state

- `message`, `images` — the draft; persisted to `localStorage` per session
  (`pi-livecraft.composer-draft.<sessionId>`).
- `slashOpen`, `slashFilter`, `slashIndex` — slash-command popover.
- `openSelect` — which dropdown (agent/model/thinking) is open.
- `behavior` — `steer` vs `followUp`, only visible while Pi is running.
- `submitting` — prevents double-send during the API call.
- `preparingImages` — blocks send while clipboard images are being converted.
- `documents`, `uploadingDocuments` — files added with the **+** button. Images from it join `images`
  (when the model accepts images); PDF, Word, Excel, CSV, text, Markdown and JSON files are uploaded to
  `POST /api/attachments` (`server/features/attachments/`), which saves them in the session folder's
  `.pi-attachments/` (with its own `.gitignore`, never overwriting) and returns the path. On send the
  message gets an "Attached file(s):" list of those paths, which Pi opens with `read_document` or `read`.
  Uploads are limited to 25 MB each; other types are refused with a notice.

## Selects

The agent, model, and thinking dropdowns each live in `selects/` as standalone
components. `ComposerSelect` is the generic Radix Select wrapper they all use.
Each select encapsulates its own option derivation and `onValueChange` logic.
`onCommand()` sends the corresponding RPC command (`set_model`,
`set_thinking_level`) to Pi.

## Draft persistence

Each session has one draft in `localStorage`. Drafts are cleared on successful
send and restored on failure.
