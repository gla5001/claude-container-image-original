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
// Escape sequences and control characters: output made only of these draws nothing. Idle claude asks the
// terminal for the cursor position (ESC[?6n) several times a second, which must not read as working.
const CONTROL = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\x00-\x1f\x7f]/g;
// What the terminal sends back on its own: cursor position, device status and attributes, focus in/out,
// OSC answers. Arrow keys and Esc don't match, so the user's own keys still count as answering.
// ponytail: Shift-F3 (ESC[1;2R) looks like a cursor position answer; nothing in claude uses it
const TERMINAL_REPORT = /^(?:\x1b\[[?>]?[\d;]*[RcnIO]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+$/;

/**
 * One interactive process in a pseudo-terminal (TUIs like `claude` need a real TTY).
 * Emits raw `output` and `state` changes; `waiting` means the live process went quiet.
 */
export class Session extends EventEmitter<{ output: [data: string]; state: [state: SessionState] }> {
  state: SessionState = { status: 'idle' };
  history = '';
  private proc?: IPty;
  private idleTimer?: NodeJS.Timeout;
  lastInputAt = 0; // when the user last typed; the terminal's own answers don't count
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
    this.setState({ status: 'starting', command: label, cwd });
    this.armIdleTimer();

    // Guards ignore late events from a process that a restart already replaced.
    proc.onData((data) => {
      if (proc !== this.proc) {
        return;
      }

      this.history = (this.history + data).slice(-HISTORY_CHARS);
      this.emit('output', data);
      if (!data.replace(CONTROL, '').trim()) {
        return; // nothing visible: not the process working
      }

      // Only count markers that end in this chunk (they may start in the previous one).
      if (BLOCKED_MARKERS.some((m) => this.history.slice(-(data.length + m.length - 1)).includes(m))) {
        this.blocked = true;
      }

      if (this.blocked) {
        this.setStatus('waiting');
      } else if (this.state.status !== 'starting' && Date.now() - this.lastInputAt > ECHO_MS) {
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
    if (!TERMINAL_REPORT.test(data)) {
      this.lastInputAt = Date.now();
      this.blocked = false;
    }

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
