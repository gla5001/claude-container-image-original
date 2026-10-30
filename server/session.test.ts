import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import type { SessionStatus } from '../shared/protocol';
import { Session } from './session';

async function waitFor(session: Session, status: SessionStatus) {
  while (session.state.status !== status) {
    await once(session, 'state');
  }
}

test('goes running → waiting on silence → exited, relaying input', async () => {
  const session = new Session(200);
  session.start({ command: 'echo ready; read x; echo "got $x"', cwd: '.', cols: 80, rows: 24 });
  assert.equal(session.state.status, 'running');

  await waitFor(session, 'waiting');
  session.write('hi\r');
  await waitFor(session, 'exited');

  assert.match(session.history, /ready/);
  assert.match(session.history, /got hi/);
  assert.equal(session.state.exitCode, 0);
});

test('a blocking prompt reads as waiting even while output keeps animating', async () => {
  const session = new Session(200);
  // Like claude during a destruction-blocker hold: prompt drawn, spinner never stops.
  session.start({
    command: 'printf "Claude is waiting on your answer\\n"; while true; do printf .; sleep 0.05; done',
    cwd: '.',
    cols: 80,
    rows: 24,
  });
  await waitFor(session, 'waiting');
  await new Promise((resolve) => setTimeout(resolve, 500)); // well past idleMs, spinner still going
  assert.equal(session.state.status, 'waiting');

  session.write('2');
  await waitFor(session, 'running');
  session.stop();
  await waitFor(session, 'exited');
});

test('stop() ends the process', async () => {
  const session = new Session(200);
  session.start({ command: 'sleep 30', cwd: '.', cols: 80, rows: 24 });
  session.stop();
  await waitFor(session, 'exited');
});

test('rejects a missing working directory', () => {
  const session = new Session();
  assert.throws(() => session.start({ command: 'true', cwd: '/nope/missing', cols: 80, rows: 24 }), /Not a directory/);
  assert.equal(session.state.status, 'idle');
});
