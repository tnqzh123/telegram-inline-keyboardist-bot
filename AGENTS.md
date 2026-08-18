# Inline Keyboardist

Inline Keyboardist is a Telegram Bot & Mini App for visually building Inline Keyboards.

Do not casually rename the product, Bot username, package, Worker, D1 binding, or public URLs. A Worker-name change changes the deployment target. The workspace directory may retain its historical name and is not a product identifier.

## Stack and source map

- Runtime: Cloudflare Workers, Static Assets, and D1.
- Bot framework: `node-telegram-bot-api` 2.x alpha. Treat the installed types and implementation as authoritative for framework middleware behavior.
- Database: Drizzle ORM with SQLite/D1.
- Mini App: React, Vite, Telegram UI, Lucide, and dnd-kit.
- `src/index.ts`: Worker routes, Telegram update handlers, Mini App API, and orchestration.
- `src/domain/keyboard.ts`: keyboard types, limits, validation, source-keyboard sanitization, and Telegram serialization.
- `src/domain/message.ts`: supported-message snapshots and summaries.
- `src/telegram-message.ts`: Telegram message/result builders and user-facing Bot copy.
- `src/inline-message-sync.ts`: updates previously sent Inline Mode messages and controls request concurrency.
- `src/db/schema.ts`: the only source of truth for the Drizzle schema.
- `app/src/App.tsx`, `app/src/styles.css`, and `app/src/drag.ts`: the WYSIWYG Mini App and drag behavior.
- `drizzle/`: generated migrations and snapshots.
- `GET /api/webhook/register` in `src/index.ts`: operator-authenticated webhook registration and `allowed_updates`.
- `assets/branding/`: editable and exported brand assets.

## Authoritative Telegram references

Telegram APIs and the framework are actively changing. Before changing Telegram fields, button types, message-edit behavior, Mini App behavior, or update handling, verify the current primary sources:

- Bot API: https://core.telegram.org/bots/api
- Mini Apps: https://core.telegram.org/bots/webapps
- Inline Mode: https://core.telegram.org/bots/inline
- Framework API: https://github.com/yagop/node-telegram-bot-api/blob/master/doc/api.md

Do not infer that an optional Telegram parameter preserves existing state. This project has verified that content-edit methods clear an existing Inline Keyboard when `reply_markup` is omitted.

## Product invariants

### Message intake

- Process ordinary content only in private chats.
- Register command handlers before the generic `message` handler. Framework middleware stops when a matched handler does not call `next()`; this prevents `/start` from also being copied as user content.
- `/start`, including a start payload or bot-qualified command, sends the help message and performs no D1 read/write.
- For supported messages, use Telegram `copyMessage` for the canonical copied message.
- Supported inputs are text, photo, video, animation, audio, voice, document, sticker, contact, static location, and venue. Captions and supported entities must be preserved.
- Do not treat a media group as independent supported messages; explain that albums are unsupported.
- Live Location is deliberately unsupported. Delete an incoming Live Location immediately and explain that the user must send a static location. Ignore queued location edits before any D1 or Telegram call.
- Do not add support for Poll, Video Note, Invoice/Pay, Paid Media, Giveaway, Game, or Service Message without an explicit product decision and current Bot API verification.

### Inline Keyboard rules

- Telegram limits for this product are fixed at 12 buttons per row and 300 buttons total. Do not lower, reinterpret, or question these limits.
- A saved keyboard must contain at least one button. The backend may defensively filter empty rows, but it must reject a keyboard that is empty after filtering.
- The WYSIWYG editor must never display a persistent empty row. Adding a new row also requires creating its first button; deleting the final button deletes that row.
- Editor-created buttons support exactly:
  - URL: `http:`, `https:`, and `tg:` URLs.
  - Copy Text: `copy_text` payloads up to the domain limit.
  - Send to: a project-generated `switch_inline_query` pointing to the current `shareId`; the user edits only its label/style.
- Do not confuse URL buttons with the Mini App control button. Telegram Web App URLs must be publicly reachable HTTPS URLs; loopback URLs are development-only and must not be sent to Telegram.
- Always derive the Mini App URL from the current Telegram update request origin, using `/app?id=<shareId>`. Keep Static Assets HTML handling configured so this clean URL serves `dist/app/index.html`; do not reintroduce a separate Mini App URL override.
- Button styles are optional and limited to Telegram `primary`, `success`, and `danger`.
- When importing a source message keyboard, retain only supported URL and Copy Text buttons. Drop callback, switch-inline, web-app, game, pay, and other unsupported buttons, then report the dropped count in the control message. Strip unsupported custom Emoji icons and report that separately.
- Never copy a source `switch_inline_query` button. Send to is created only by this project so it always targets the correct `shareId`.

### Source edits and Inline Mode synchronization

- Editing the user's source message updates the canonical copied message and every recorded Inline Mode copy whose `inline_message_id` is known.
- Content edits must not change the saved keyboard. Always pass the current serialized `reply_markup` explicitly to `editMessageText`, `editMessageMedia`, and `editMessageCaption` for both the copied message and Inline Mode copies. Omitting it clears the keyboard in practice.
- Inline media edits must reuse Telegram `file_id`; inline-message edits cannot upload a new local file.
- Saving a keyboard updates the copied message first, stores the validated keyboard, and then updates all recorded Inline Mode copies with `editMessageReplyMarkup`.
- Record `chosen_inline_result.inline_message_id` by `result_id`/`shareId`. One source can have many Inline copies. Use an idempotent insert with a unique `inline_message_id`; do not add a pre-read.
- `chosen_inline_result` must remain in webhook `allowed_updates`, and production must have BotFather Inline feedback enabled at 100% or some shared messages will not be recorded.
- Deployment must not register or modify the Telegram Webhook. Registration occurs only when an operator calls `GET /api/webhook/register?secret_token=...` with a value matching `WEBHOOK_SECRET_TOKEN`. The route registers `/update` on the request's HTTPS origin and passes the same value to Telegram as `secret_token`.
- Do not restore a deploy/postdeploy webhook hook or a local setup-webhook script. Never echo, log, document, or persist the supplied query secret.
- Fetch all Inline copy IDs with one indexed D1 query. Update Telegram in batches of at most six concurrent requests and isolate individual failures with `Promise.allSettled`.
- A failed Inline-copy update is best effort: log it without failing the canonical update. Do not delete a recorded ID merely because one request failed; network failures and rate limits may be transient.
- Do not introduce revision columns, optimistic locks, or similar coordination unless a demonstrated race requires them and the user explicitly accepts the added complexity.

## Data and cost constraints

- Never download or store media bytes. Store Telegram `file_id` and the minimum metadata required to rebuild/edit messages.
- Authenticate Mini App requests with Telegram `initData` on the server. Authorize ownership by matching the authenticated Telegram user ID to the private-chat `chatId`.
- Editing is local in the Mini App. Save only when the user presses the manual-save action; do not add autosave.
- If a validated keyboard is unchanged, do not call Telegram and do not write D1.
- Preserve the low-request model: avoid pre-reads before inserts, avoid duplicated message queries, and retrieve all Inline-copy IDs in one indexed query.
- Do not add analytics, media storage, polling, queues, caches, or new databases unless the task requires them and the cost tradeoff is explicit.
- Never log or commit `BOT_TOKEN`, `WEBHOOK_SECRET_TOKEN`, Telegram `initData`, full webhook-registration URLs, or other credentials. Keep local secrets in `.dev.vars` and production secrets in Wrangler secrets.

## Drizzle and D1 workflow

- Change tables in `src/db/schema.ts` using Drizzle.
- Generate migrations with `npx drizzle-kit generate --name <descriptive-name>`. Do not hand-write a parallel migration or manually edit generated snapshots.
- Inspect every generated `migration.sql` before applying it.
- A generated migration is not automatically applied by `wrangler dev`. After a schema change, apply it to the same local persistence used by development:

  ```bash
  npx wrangler d1 migrations apply D1 --local
  ```

- Verify local state with `npx wrangler d1 migrations list D1 --local`. A `no such table` error normally means the migration was generated but not applied; do not hide this with a runtime table-creation fallback.
- Apply pending migrations remotely before deploying code that queries the new schema:

  ```bash
  npm run db:migrations:apply
  ```

- `npm run deploy` must apply remote D1 migrations through the `D1` binding before `wrangler deploy`. Preserve this ordering so code that needs a new schema is never published first.
- Keep Deploy to Cloudflare metadata synchronized across `wrangler.jsonc`, `.dev.vars.example`, `package.json.cloudflare.bindings`, and the README button. D1 must remain auto-provisionable and required secrets must remain visible in the deployment form.
- Remote migration, deployment, webhook setup, and BotFather changes are external mutations. Perform them only when the user explicitly asks; otherwise provide the exact handoff command.

## Mini App design and interaction

- Keep the UI Telegram-native and functional in both Light and Dark Mode. Prefer Telegram UI components, then existing project patterns; use Lucide for icons and avoid Emoji as UI icons.
- The message/keyboard area is the WYSIWYG editor. Do not reintroduce a separate card-list editor for the same buttons.
- Preserve the current drag model: buttons can reorder within a row, move across rows, or be dropped on the new-row action; rows reorder via their left handle. While dragging into a populated row, show the shrunken layout and a semi-transparent insertion placeholder.
- The floating drag overlay must remain compact enough not to obscure the insertion preview.
- The button sheet distinguishes “添加按钮” and “编辑按钮”, shows the button preview at the top, and exposes deletion as a trash-only action when editing.
- Mobile keyboards and Telegram's `VisualViewport` are high-risk. Verify that opening the keyboard does not scroll the sheet past the form and that tapping style controls does not dismiss the editor.
- Keep field boundaries visibly distinct in both themes. Use Telegram theme variables and the established blue/green/red palette rather than defaulting to generic blue-purple gradients.
- Brand name: `Inline Keyboardist`. Bot username: `@InlineKeyboardistBot`. Preserve the code-native blue/green/white mark in `assets/branding/`.

## Validation and handoff

- Preserve unrelated user changes in a dirty worktree.
- Add or update focused tests for domain rules, handler routing, serialization, synchronization, and drag math.
- Before handing off a code change, run:

  ```bash
  git diff --check
  npm run typecheck
  npm test
  npm run build
  ```

- After Worker/configuration changes, also run a Wrangler dry-run. If Wrangler cannot write its default log outside the workspace, set `WRANGLER_LOG_PATH` to a task-specific file under `/private/tmp`:

  ```bash
  WRANGLER_LOG_PATH=/private/tmp/inline-keyboardist-wrangler.log npx wrangler deploy --dry-run
  ```

- For meaningful Mini App changes, inspect demo mode in both themes (`?demo=1&theme=light` and `?demo=1&theme=dark`) and test a narrow mobile viewport. Drag changes require the focused drag tests as well as manual visual verification when possible.

# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
