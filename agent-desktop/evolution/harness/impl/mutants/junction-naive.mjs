/**
 * Planted failure mutant — **junction-naive**.
 *
 * Simulates a skill with naive NTFS junction handling: it resolves
 * junction links to themselves (operating on the link path), traverses
 * junction cycles without a visited set (never terminates), and cleans
 * up by deleting the junction target's contents instead of just the
 * link. Expected failures: jct-resolve, jct-traverse, jct-cleanup.
 */
import reference from '../reference.mjs';
import { rmSync } from 'node:fs';

export default {
  ...reference,
  id: 'junction-naive',
  label: 'mutant: naive junction handling',

  jctResolve(sandbox) {
    // wrong: returns the link path itself, never the real target
    return { resolvedPath: sandbox.path('link'), message: 'path as-is' };
  },

  jctTraverse() {
    // wrong: naive recursion would loop forever on a junction cycle —
    // reported as non-terminating (the harness must never hang, so the
    // mutant *declares* the runaway instead of looping).
    return { terminated: false, visited: 0, message: 'would loop forever (junction cycle)' };
  },

  jctCleanup(sandbox) {
    // wrong: removes the target contents too (deletes keep.txt)
    if (sandbox.exists('real/target')) rmSync(sandbox.path('real/target'), { recursive: true, force: true });
    if (sandbox.exists('link')) rmSync(sandbox.path('link'), { recursive: true, force: true });
    return { linkRemoved: true, targetIntact: false, message: 'cleaned (target contents destroyed)' };
  },
};
