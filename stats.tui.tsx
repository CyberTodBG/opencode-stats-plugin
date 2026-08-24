/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { JSX } from "@opentui/solid"
import { createSignal, Show } from "solid-js"

const id = "opencode-stats"

interface Usage {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

function emptyUsage(): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

function fmt(n: number): string {
  const s = Math.trunc(n).toString()
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

// Token usage lives on the assistant Message as `info.tokens`
function messageTokens(info: any): Usage | null {
  if (!info || info.role !== "assistant") return null
  const t = info.tokens
  if (!t) return null
  return {
    input: Number(t.input ?? 0),
    output: Number(t.output ?? 0),
    reasoning: Number(t.reasoning ?? 0),
    cacheRead: Number(t.cache?.read ?? 0),
    cacheWrite: Number(t.cache?.write ?? 0),
  }
}

function getActiveSessionID(api: TuiPluginApi): string | undefined {
  if (api.route.current.name !== "session") return undefined
  return api.route.current.params?.sessionID as string | undefined
}

function formatReport(totals: Usage, tokPerSec: number, avgTokPerSec: number): string {
  const rows = [
    ["Input (prompt)", fmt(totals.input)],
    ["Output (completion)", fmt(totals.output)],
    ["Reasoning", fmt(totals.reasoning)],
    ["Cache read", fmt(totals.cacheRead)],
    ["Cache write", fmt(totals.cacheWrite)],
    ["Total", fmt(totals.input + totals.output + totals.reasoning)],
    ["Total (incl. cache)", fmt(totals.input + totals.output + totals.reasoning + totals.cacheRead + totals.cacheWrite)],
  ]
  const labelW = Math.max(...rows.map((r) => r[0].length))
  const body = rows.map(([k, v]) => k.padEnd(labelW) + "   " + v).join("\n")
  const speed =
    tokPerSec > 0
      ? `Generation speed — last: ${tokPerSec.toFixed(1)} tok/s, average: ${avgTokPerSec.toFixed(1)} tok/s`
      : "Generation speed: not measured yet this session"
  const note =
    "Data sourced from OpenCode's internal token reporting; accuracy depends on the provider's usage metadata."
  return ["Session Stats", "", body, "", speed, "", note].join("\n")
}

function StatsDialog(props: { api: TuiPluginApi; output: string }) {
  const lines = () => props.output.split("\n")
  return (
    <box gap={1} width="100%" flexGrow={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={props.api.theme.current.text}>
        <b>Session Stats</b>
      </text>
      <scrollbox width="100%" flexGrow={1} minHeight={6} maxHeight={28}>
        <box gap={0} width="100%" minWidth={0}>
          {lines().map((line) => (
            <text fg={props.api.theme.current.text} wrapMode="word" width="100%">
              {line || " "}
            </text>
          ))}
        </box>
      </scrollbox>
      <text fg={props.api.theme.current.textMuted}>esc closes</text>
    </box>
  )
}

async function buildTotals(api: TuiPluginApi, sessionID: string): Promise<Usage> {
  let totals = emptyUsage()
  try {
    const messages: any[] = await api.client.session.messages({ path: { id: sessionID } })
    for (const message of messages) {
      // The client may wrap as { info } or return the Message directly
      const u = messageTokens(message?.info) ?? messageTokens(message)
      if (u) totals = addUsage(totals, u)
    }
  } catch {
    // ignore; fall back to live-tracked totals
  }
  return totals
}

function eventInfo(event: any): any {
  return event?.properties?.info ?? event?.data?.info
}
function eventSession(event: any): string | undefined {
  return event?.properties?.sessionID ?? event?.data?.sessionID
}

const tui: TuiPlugin = async (api) => {
  const [tokPerSec, setTokPerSec] = createSignal(0)
  const [avgTokPerSec, setAvgTokPerSec] = createSignal(0)
  const [liveTotals, setLiveTotals] = createSignal<Usage>(emptyUsage())
  // per-session map of messageID -> usage, to avoid double counting on repeated updates
  const sessionMessages = new Map<string, Map<string, Usage>>()
  // per-session tok/s samples for the running average (one sample per completed request)
  const sessionSamples = new Map<string, { samples: number[]; seen: Set<string> }>()

  const recompute = (sessionID: string): Usage => {
    const map = sessionMessages.get(sessionID)
    if (!map) return emptyUsage()
    let totals = emptyUsage()
    for (const u of map.values()) totals = addUsage(totals, u)
    return totals
  }

  const disposers = [
    api.event.on("message.updated", (event: any) => {
      const info = eventInfo(event)
      const sessionID = eventSession(event)
      if (!info || !sessionID) return
      const u = messageTokens(info)
      if (!u) return
      if (!sessionMessages.has(sessionID)) sessionMessages.set(sessionID, new Map())
      sessionMessages.get(sessionID)!.set(info.id, u)
      const totals = recompute(sessionID)
      if (sessionID === getActiveSessionID(api)) setLiveTotals(totals)
      const created = info.time?.created
      const completed = info.time?.completed
      if (typeof created === "number" && typeof completed === "number" && completed > created) {
        const elapsed = (completed - created) / 1000
        if (elapsed > 0 && u.output > 0 && sessionID === getActiveSessionID(api)) {
          const thisTok = u.output / elapsed
          setTokPerSec(thisTok)
          if (!sessionSamples.has(sessionID)) sessionSamples.set(sessionID, { samples: [], seen: new Set() })
          const st = sessionSamples.get(sessionID)!
          if (!st.seen.has(info.id)) {
            st.seen.add(info.id)
            st.samples.push(thisTok)
            setAvgTokPerSec(st.samples.reduce((a, b) => a + b, 0) / st.samples.length)
          }
        }
      }
    }),
  ]
  api.lifecycle.onDispose(() =>
    disposers.forEach((d) => typeof d === "function" && (d as () => void)()),
  )

  const disposeCmd = api.keymap.registerLayer({
    commands: [
      {
        namespace: "palette",
        name: "opencode-stats.open",
        title: "Session stats",
        desc: "Show token usage (input/output/cache) and generation speed",
        category: "Plugin",
        slashName: "stats",
        async run() {
          const sessionID = getActiveSessionID(api)
          if (!sessionID) {
            api.ui.toast({ variant: "error", message: "No active session" })
            return
          }
          const fromClient = await buildTotals(api, sessionID)
          const fromEvents = recompute(sessionID)
          // Prefer the client snapshot when it has data; otherwise use event-accumulated totals
          const totals =
            fromClient.input + fromClient.output + fromClient.reasoning > 0 ? fromClient : fromEvents
          api.ui.dialog.replace(() => (
            <StatsDialog api={api} output={formatReport(totals, tokPerSec(), avgTokPerSec())} />
          ))
          api.ui.dialog.setSize("large")
        },
      },
    ],
    bindings: [],
  })
  api.lifecycle.onDispose(disposeCmd)

  // tok/s rendered in the right region of the prompt bar, next to the context usage line
  api.slots.register({
    order: 90,
    slots: {
      session_prompt_right(_ctx, _props: any) {
        return (
          <Show when={tokPerSec() > 0}>
            <text fg={api.theme.current.textMuted} wrapMode="none">
              {`${tokPerSec().toFixed(1)} tok/s (avg ${avgTokPerSec().toFixed(1)}) · in ${fmt(liveTotals().input)} / out ${fmt(liveTotals().output)}`}
            </text>
          </Show>
        )
      },
    },
  })
}

const pluginModule: TuiPluginModule & { id: string } = { id, tui }
export default pluginModule
