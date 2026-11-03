import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SessionStatus } from '../shared/protocol';
import { SettingsDialog } from './SettingsDialog';
import { Terminal, type TerminalHandle } from './Terminal';
import { button, field, fieldInput } from './ui';
import { usePush, type PushStatus } from './usePush';
import { useSession } from './useSession';

const STARTING = {
  label: 'Starting',
  hint: 'Starting Claude…',
  dot: 'bg-zinc-400',
  accent: 'border-zinc-200 text-zinc-500',
  bar: 'bg-zinc-50',
};

const STATUS: Record<SessionStatus, { label: string; hint: string; dot: string; accent: string; bar: string }> = {
  idle: STARTING,
  starting: STARTING,
  running: {
    label: 'Working',
    hint: 'Process is producing output…',
    dot: 'bg-emerald-500 animate-pulse',
    accent: 'border-emerald-300 text-emerald-700',
    bar: 'bg-emerald-50',
  },
  waiting: {
    label: 'Needs input',
    hint: 'Waiting on you. Answer the prompt in the terminal.',
    dot: 'bg-amber-500',
    accent: 'border-amber-300 text-amber-700',
    bar: 'bg-amber-50',
  },
  exited: {
    label: 'Exited',
    hint: 'Claude exited. Restart to pick up the conversation where it left off.',
    dot: 'bg-zinc-400',
    accent: 'border-zinc-200 text-zinc-500',
    bar: 'bg-zinc-50',
  },
};

const NOTIFY_TITLE: Record<PushStatus, string> = {
  unsupported: 'Notifications need HTTPS or localhost. On iPhone and iPad, add this page to the Home Screen first',
  denied: 'Notifications are blocked. Allow them for this site in your browser settings',
  off: 'Notify me when Claude needs input',
  on: 'Notifications are on',
};

// Keys TUIs like claude use to navigate menus and answer prompts.
const KEYS = [
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: 'Enter', data: '\r' },
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: '⇧ Tab', data: '\x1b[Z' },
  { label: '1', data: '1' },
  { label: '2', data: '2' },
  { label: '3', data: '3' },
  { label: 'Ctrl C', data: '\x03' },
];

export default function App() {
  const terminal = useRef<TerminalHandle>(null);
  const { connected, state, settings, error, pushKey, restart, input, resize, setOAuthToken, subscribePush } =
    useSession(terminal);
  const push = usePush(pushKey, subscribePush);
  const [reply, setReply] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const live = state.status === 'starting' || state.status === 'running' || state.status === 'waiting';
  const meta = STATUS[state.status];

  // Flag the tab when the session blocks. The server sends the push notification.
  useEffect(() => {
    document.title = state.status === 'waiting' ? '● Needs input · Session Runner' : 'Session Runner';
  }, [state.status]);

  const onRestart = () => {
    restart();
    terminal.current?.focus();
  };

  const onReply = (e: FormEvent) => {
    e.preventDefault();
    input(reply);
    // ponytail: Enter goes separately, otherwise TUIs treat "text\r" as a paste and don't submit
    setTimeout(() => input('\r'), 50);
    setReply('');
  };

  const onSaveToken = (token: string, restartNow: boolean) => {
    setOAuthToken(token);
    if (restartNow) {
      onRestart();
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-400 to-rose-500 font-mono text-xs font-bold text-white">
            &gt;_
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">Session Runner</h1>
            <p className="truncate font-mono text-xs text-zinc-500">{state.cwd ?? 'No session yet'}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!connected && <span className="text-xs text-rose-600">Reconnecting…</span>}
          <span
            role="status"
            className={`flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs font-medium ${meta.accent}`}
          >
            <span className="relative flex size-2">
              {state.status === 'waiting' && (
                <span className={`absolute inset-0 animate-ping rounded-full ${meta.dot}`} />
              )}
              <span className={`relative size-2 rounded-full ${meta.dot}`} />
            </span>
            {meta.label}
          </span>
          <button
            type="button"
            onClick={() => void push.enable()}
            disabled={push.status !== 'off'}
            aria-label={NOTIFY_TITLE[push.status]}
            title={NOTIFY_TITLE[push.status]}
            className={`grid size-8 place-items-center rounded-lg transition enabled:hover:bg-zinc-100 enabled:hover:text-zinc-900 disabled:cursor-default ${
              push.status === 'on' ? 'text-emerald-600' : 'text-zinc-500'
            } ${push.status === 'unsupported' || push.status === 'denied' ? 'opacity-40' : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="size-5" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
            className="grid size-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="size-5" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </button>
        </div>
      </header>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tokenSet={settings.oauthTokenSet}
        live={live}
        onSave={onSaveToken}
      />

      <main className="flex min-h-0 w-full flex-1 flex-col gap-3 p-4 sm:p-6">
        <div className="flex gap-2">
          {/* Read-only: the server always runs claude. */}
          <div
            aria-label="Command"
            className="flex flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 font-mono text-sm text-zinc-700"
          >
            <span className="text-orange-500">$</span>
            {state.command ?? 'claude'}
          </div>
          {/* Highlighted once claude has exited, since restarting is then the way forward. */}
          <button
            type="button"
            onClick={onRestart}
            disabled={!connected || state.status === 'idle'}
            title="Restart Claude and continue the same conversation"
            className={`${button} ${
              state.status === 'exited'
                ? 'bg-orange-500 text-white hover:bg-orange-600'
                : 'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            Restart
          </button>
        </div>

        {(error ?? push.error) && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error ?? push.error}
          </p>
        )}

        <section
          className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-colors ${meta.accent}`}
        >
          <div
            className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-xs ${meta.accent} ${meta.bar}`}
          >
            <span>{meta.hint}</span>
            {state.status === 'exited' && <span className="font-mono">exit code {state.exitCode}</span>}
          </div>
          <div className="min-h-0 flex-1 p-3" onClick={() => terminal.current?.focus()}>
            <Terminal ref={terminal} onData={input} onResize={resize} />
          </div>
        </section>

        <form onSubmit={onReply} className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {KEYS.map((key) => (
              <button
                key={key.label}
                type="button"
                disabled={!live}
                onClick={() => input(key.data)}
                className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 font-mono text-xs text-zinc-700 shadow-xs transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {key.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <label className={`${field} flex-1`}>
              <input
                aria-label="Reply to the session"
                className={fieldInput}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                disabled={!live}
                placeholder={
                  live ? 'Type a reply and press Enter, or type straight into the terminal' : 'Restart Claude to reply'
                }
              />
            </label>
            <button type="submit" disabled={!live} className={`${button} bg-zinc-900 text-white hover:bg-zinc-700`}>
              Send
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
