/**
 * Child process for process-guards.test.ts. Argument: `guarded` installs the guards first, `bare` does not.
 * It then does the two things that end a Bun process — abandons a rejected promise, and throws out of a timer
 * callback — and, if it is still running 300 ms later, says so and exits 0.
 */
import { installProcessGuards } from '../../lib/process-guards';

if (process.argv[2] === 'guarded') {
  installProcessGuards({ error: (obj, msg) => console.log(`logged ${msg}: ${String((obj.err as Error)?.message ?? obj.err)}`) });
  // A second install must not double the listeners.
  installProcessGuards({ error: () => console.log('second install must not log') });
}

void Promise.reject(new Error('abandoned promise'));
setTimeout(() => {
  throw new Error('thrown in a timer');
}, 50);
setTimeout(() => {
  console.log('still serving');
  process.exit(0);
}, 300);
