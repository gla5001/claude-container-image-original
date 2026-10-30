import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SessionStatus } from '../shared/protocol';
import { Terminal, type TerminalHandle } from './Terminal';
import { useSession } from './useSession';

const STATUS: Record<SessionStatus, { label: string; hint: string; dot: string; accent: string; bar: string }> = {
  idle: {
    label: 'Idle',
    hint: 'Start a command to begin.',
    dot: 'bg-zinc-400',
    accent: 'border-zinc-200 text-zinc-500',
    bar: 'bg-zinc-50',
  },
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
    hint: 'Process finished.',
    dot: 'bg-zinc-400',
    accent: 'border-zinc-200 text-zinc-500',
    bar: 'bg-zinc-50',
  },
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

const field =
  'flex items-center rounded-lg border border-zinc-300 bg-white shadow-xs focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-400/20';
const fieldInput =
  'min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 disabled:text-zinc-500';
const button =
  'rounded-lg px-4 py-2 text-sm font-medium shadow-xs transition disabled:cursor-not-allowed disabled:opacity-40';

export default function App() {
  const terminal = useRef<TerminalHandle>(null);
  const { connected, state, error, start, stop, input, resize } = useSession(terminal);
  const [command, setCommand] = useState('claude');
  const [reply, setReply] = useState('');
  const live = state.status === 'running' || state.status === 'waiting';
  const meta = STATUS[state.status];

  // Pull the user back when the session blocks.
  useEffect(() => {
    const waiting = state.status === 'waiting';
    document.title = waiting ? '● Needs input · Session Runner' : 'Session Runner';
    if (waiting && document.hidden && Notification.permission === 'granted') {
      new Notification('Session needs your input', { body: state.command });
    }
  }, [state.status, state.command]);

  const onStart = (e: FormEvent) => {
    e.preventDefault();
    if (Notification.permission === 'default') {
      void Notification.requestPermission();
    }

    start(command);
    terminal.current?.focus();
  };

  const onReply = (e: FormEvent) => {
    e.preventDefault();
    input(reply);
    // ponytail: Enter goes separately, otherwise TUIs treat "text\r" as a paste and don't submit
    setTimeout(() => input('\r'), 50);
    setReply('');
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
            <p className="truncate font-mono text-xs text-zinc-500">
              {state.command ? `${state.command}  ·  ${state.cwd}` : 'No session yet'}
            </p>
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
        </div>
      </header>

      <main className="flex min-h-0 w-full flex-1 flex-col gap-3 p-4 sm:p-6">
        <form onSubmit={onStart} className="flex gap-2">
          <label className={`${field} flex-1`}>
            <span className="pl-3 font-mono text-sm text-orange-500">$</span>
            <input
              aria-label="Command"
              className={`${fieldInput} font-mono`}
              value={live ? state.command : command}
              onChange={(e) => setCommand(e.target.value)}
              disabled={live}
              placeholder="claude"
              required
            />
          </label>
          {live ? (
            <button
              type="button"
              onClick={stop}
              className={`${button} border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!connected}
              className={`${button} bg-orange-500 text-white hover:bg-orange-600`}
            >
              {state.status === 'exited' ? 'Restart' : 'Start'}
            </button>
          )}
        </form>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
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
                  live ? 'Type a reply and press Enter, or type straight into the terminal' : 'Start a session to reply'
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
