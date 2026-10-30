import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { TermSize } from '../shared/protocol';

export interface TerminalHandle {
  write(data: string): void;
  reset(): void;
  focus(): void;
  size(): TermSize;
}

interface Props {
  ref: Ref<TerminalHandle>;
  /** Must be stable: the terminal is created once. */
  onData: (data: string) => void;
  onResize: (size: TermSize) => void;
}

export function Terminal({ ref, onData, onResize }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm>(null);

  useEffect(() => {
    const xterm = new XTerm({
      scrollback: 1000, // a little history, not the whole session
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      // Claude's dark-theme panels pair default (dark here) text with a dark background; lift it to readable.
      minimumContrastRatio: 4.5,
      // Light palette; "white" maps to grays so programs that assume a dark background stay readable.
      theme: {
        background: '#ffffff',
        foreground: '#27272a',
        cursor: '#f97316',
        cursorAccent: '#ffffff',
        selectionBackground: '#fed7aa',
        black: '#27272a',
        red: '#dc2626',
        green: '#15803d',
        yellow: '#b45309',
        blue: '#2563eb',
        magenta: '#9333ea',
        cyan: '#0e7490',
        white: '#71717a',
        brightBlack: '#71717a',
        brightRed: '#ef4444',
        brightGreen: '#16a34a',
        brightYellow: '#ca8a04',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#0891b2',
        brightWhite: '#52525b',
      },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(container.current!);
    xterm.onData(onData);
    xterm.onResize(onResize);
    fit.fit();

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(container.current!);
    term.current = xterm;
    return () => {
      observer.disconnect();
      xterm.dispose();
    };
  }, [onData, onResize]);

  useImperativeHandle(ref, () => ({
    write: (data) => term.current?.write(data),
    reset: () => term.current?.reset(),
    focus: () => term.current?.focus(),
    size: () => ({ cols: term.current?.cols ?? 80, rows: term.current?.rows ?? 24 }),
  }));

  return <div ref={container} className="h-full w-full" />;
}
