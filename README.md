# opencode-stats-plugin

A small OpenCode **TUI plugin** that adds a `/stats` command showing per-session
token usage (input, output, reasoning, cache read/write) and live generation
speed in **tok/s**.
The entire plugin was written (vibe coded) and debugged with OpenCode itself.

## What it does

- **`/stats`** opens a popup (dialog) with a token breakdown for the current
  session:
  - Input (prompt), Output (completion), Reasoning
  - Cache read, Cache write
  - `Total` (input + output + reasoning, cache excluded — cache tokens are
    priced differently)
  - `Total (incl. cache)` (all token categories summed)
  - `Generation speed (last request)` in tok/s
  - A note that the data comes from OpenCode's own token reporting.
- **Live tok/s** is rendered in the prompt bar (the `session_prompt_right`
  slot, next to the model/context area) after each request completes.
- All data is taken from OpenCode's internal reporting; accuracy depends on the
  provider's usage metadata (e.g. reasoning/cache are `0` when the model or
  provider does not report them).

## How it works

- It is a **TUI plugin** (`@opencode-ai/plugin/tui`), not a server plugin.
  Server slash commands always trigger a model turn, so a popup requires the TUI
  plugin API (`api.keymap.registerLayer` with `slashName: "stats"` → opens
  `api.ui.dialog.replace(...)`).
- Token counts are read from each assistant message's `info.tokens`
  (`{ total, input, output, reasoning, cache: { read, write } }`), which
  OpenCode exposes on `message.updated` events. The plugin accumulates these
  per session (keyed by `messageID` to avoid double counting) and recomputes
  totals. The `/stats` dialog prefers a snapshot from `api.client.session.messages`,
  falling back to the event-accumulated totals.
- Generation speed is computed from the finished message's `time.completed -
  time.created` divided by its output token count.
- The tok/s readout is shown via the `session_prompt_right` slot.

## Files

- `stats.tui.tsx` — the plugin (default export `{ id, tui }`).
- `tui.json` — TUI config snippet that registers the plugin.
- `package.json` — the dependencies the plugin imports.

## How to install

1. **Locate your OpenCode config directory.** This is the directory OpenCode
   actually reads — by default on Linux/WSL `~/.config/opencode`.
   Project-level config can also live in `.opencode/` inside a repo.

2. **Copy the plugin** into the plugins folder of that config dir:

   ```sh
   mkdir -p ~/.config/opencode/plugins
   cp stats.tui.tsx ~/.config/opencode/plugins/stats.tui.tsx
   ```

3. **Register it in `tui.json`** (create or merge with the existing file in the
   config dir):

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["./plugins/stats.tui.tsx"]
   }
   ```

4. **Install the dependencies.** The plugin imports `@opencode-ai/plugin/tui`,
   `@opentui/solid`, and `solid-js`. Add them to the config dir's `package.json`
   (OpenCode runs an install step on it at startup), then install:

   ```sh
   # in the config dir (~/.config/opencode)
   cat package.json        # should list the three deps below
   npm install             # or let OpenCode's own startup install run
   ```

   Required dependencies:

   ```json
   {
     "dependencies": {
       "@opencode-ai/plugin": "1.18.16",
       "@opentui/solid": "0.4.5",
       "solid-js": "^1.9.12"
     }
   }
   ```

5. **Restart OpenCode.** Type `/stats` to open the popup. The tok/s readout
   appears in the prompt bar after a request completes.

### Notes

- TUI plugins are not auto-discovered; they must be listed in `tui.json`.
- This plugin is fully separate from the OpenCode binary (loaded via config),
  so it survives OpenCode updates.
- If the popup shows "not measured yet", generate at least one request first so
  `message.updated` events populate the totals.
