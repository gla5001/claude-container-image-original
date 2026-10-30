import { EventEmitter } from 'node:events';
import { statSync } from 'node:fs';
import { spawn, type IPty } from 'node-pty';
import type { SessionState, SessionStatus, TermSize } from '../shared/protocol';

const SHELL = process.env.SHELL ?? '/bin/sh';
const HISTORY_CHARS = 200_000; // raw output replayed to clients that (re)connect mid-session
const ECHO_MS = 250; // output this soon after a keystroke is the echo, not the process working
// Prompts that block on the user while the TUI keeps animating (so silence never comes).
// ponytail: plain string match on what claude and the destruction-blocker mod print today; add new prompts here
const BLOCKED_MARKERS = ['Claude is waiting on your answer', 'Do you want to proceed?'];

/**
 * One interactive process in a pseudo-terminal (TUIs like `claude` need a real TTY).
 * Emits raw `output` and `state` changes; `waiting` means the live process went quiet.
 */
export class Session extends EventEmitter<{ output: [data: string]; state: [state: SessionState] }> {
  state: SessionState = { status: 'idle' };
  history = '';
  private proc?: IPty;
  private idleTimer?: NodeJS.Timeout;
  private lastInputAt = 0;
  private blocked = false; // a blocking prompt is on screen; cleared when the user answers

  // ponytail: "quiet for idleMs = blocked on the user" heuristic; switch to Claude's Notification hook if it misfires
  constructor(private readonly idleMs = 1500) {
    super();
  }

  /**
   * `label` is the command clients see (defaults to `command`).
   * `env` is layered over the server's environment; an `undefined` value removes that variable.
   */
  start({
    command,
    label = command,
    cwd,
    cols,
    rows,
    env = {},
  }: { command: string; label?: string; cwd: string; env?: Record<string, string | undefined> } & TermSize) {
    if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Not a directory: ${cwd}`);
    }

    this.stop();
    // If this server was started from inside Claude Code, don't let the child think it's nested.
    const { CLAUDECODE, CLAUDE_CODE_CHILD_SESSION, ...inherited } = process.env;
    const merged = { ...inherited, COLORTERM: 'truecolor', ...env };
    const proc = spawn(SHELL, ['-c', command], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: Object.fromEntries(
        Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    });
    this.proc = proc;
    this.history = '';
    this.blocked = false;
    this.setState({ status: 'running', command: label, cwd });
    this.armIdleTimer();

    // Guards ignore late events from a process that a restart already replaced.
    proc.onData((data) => {
      if (proc !== this.proc) {
        return;
      }

      this.history = (this.history + data).slice(-HISTORY_CHARS);
      this.emit('output', data);
      // Only count markers that end in this chunk (they may start in the previous one).
      if (BLOCKED_MARKERS.some((m) => this.history.slice(-(data.length + m.length - 1)).includes(m))) {
        this.blocked = true;
      }

      if (this.blocked) {
        this.setStatus('waiting');
      } else if (Date.now() - this.lastInputAt > ECHO_MS) {
        this.setStatus('running');
      }

      this.armIdleTimer();
    });
    proc.onExit(({ exitCode }) => {
      if (proc !== this.proc) {
        return;
      }

      this.proc = undefined;
      clearTimeout(this.idleTimer);
      this.setState({ ...this.state, status: 'exited', exitCode });
    });
  }

  write(data: string) {
    this.lastInputAt = Date.now();
    this.blocked = false;
    this.proc?.write(data);
  }

  resize({ cols, rows }: TermSize) {
    try {
      this.proc?.resize(cols, rows);
    } catch {
      // process exited between messages
    }
  }

  stop() {
    if (!this.proc) {
      return;
    }

    // Hang up the whole process group so children of the wrapping shell exit too.
    try {
      process.kill(-this.proc.pid, 'SIGHUP');
    } catch {
      this.proc.kill();
    }
  }

  private armIdleTimer() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.setStatus('waiting'), this.idleMs);
  }

  private setStatus(status: SessionStatus) {
    if (this.state.status !== status) {
      this.setState({ ...this.state, status });
    }
  }

  private setState(state: SessionState) {
    this.state = state;
    this.emit('state', state);
  }
}
