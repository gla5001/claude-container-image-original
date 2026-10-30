import { useEffect, useRef, useState, type FormEvent } from 'react';
import { button, field, fieldInput } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  /** A token was set here before (the server never sends the token itself back). */
  tokenSet: boolean;
  /** A session is running, so it can be restarted onto the new token. */
  live: boolean;
  /** An empty token removes the one set here. */
  onSave: (token: string, restartNow: boolean) => void;
}

export function SettingsDialog({ open, onClose, tokenSet, live, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [token, setToken] = useState('');
  const [restartNow, setRestartNow] = useState(true);

  // A native modal <dialog> brings the backdrop, focus trap and Esc-to-close.
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [open]);

  // Don't keep a typed token around once the dialog is gone.
  const close = () => {
    setToken('');
    onClose();
  };

  const save = (value: string) => {
    onSave(value, live && restartNow);
    close();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save(token.trim());
  };

  return (
    <dialog
      ref={dialog}
      onClose={close}
      aria-labelledby="settings-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-900/40 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={onSubmit}>
        <div className="space-y-4 p-6">
          <div>
            <h2 id="settings-title" className="text-base font-semibold">
              Claude account
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Paste an OAuth token to sign Claude in with a different account, or to replace an expired one. Create one
              on your machine with{' '}
              <code className="rounded bg-zinc-100 px-1 font-mono text-xs">claude setup-token</code>.
            </p>
          </div>

          <p className="flex items-center gap-2 text-xs text-zinc-600">
            <span className={`size-2 shrink-0 rounded-full ${tokenSet ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
            {tokenSet ? 'Using a token set here.' : 'Using the token the server started with, if any.'}
          </p>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-700">New token</span>
            <span className={field}>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="sk-ant-oat01-…"
                pattern="\s*[!-~]+\s*"
                maxLength={4096}
                className={`${fieldInput} font-mono`}
              />
            </span>
          </label>

          {live && (
            <label className="flex items-start gap-2.5 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={restartNow}
                onChange={(e) => setRestartNow(e.target.checked)}
                className="mt-0.5 size-4 accent-orange-500"
              />
              <span>
                Restart the running session now
                <span className="block text-xs text-zinc-500">
                  Claude picks up where it left off in the same conversation, on the new account.
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-b-xl border-t border-zinc-200 bg-zinc-50 px-6 py-3">
          {tokenSet && (
            <button
              type="button"
              onClick={() => save('')}
              className="text-sm text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
            >
              Remove saved token
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={close}
              className={`${button} border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!token.trim()}
              className={`${button} bg-orange-500 text-white hover:bg-orange-600`}
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
