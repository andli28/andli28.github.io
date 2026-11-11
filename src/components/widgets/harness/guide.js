// What to point at after a failed run. Following it always ends at the job's
// known solution: missing parts come on first (a part the job introduces is
// handed over as "new"), then anything extra goes off.

import { simulate } from "./engine.js";
import { FAILS, PARTS } from "./world.js";

export function advise(job, on, owned, res) {
  const fix = job.fix?.[res.reason] ?? FAILS[res.reason].fix(res.info);
  const missing = job.sol.filter(id => !on.includes(id));
  const pick = missing.includes(fix) ? fix : missing[0];
  if (pick) return { part: pick, kind: owned.includes(pick) ? "on" : "new" };
  const extra = on.filter(id => !job.sol.includes(id));
  // prefer the one whose removal fixes the run by itself
  const culprit =
    extra.find(
      x =>
        simulate(
          job,
          on.filter(id => id !== x && PARTS[id].needs !== x)
        ).ok
    ) ?? extra[0];
  return culprit ? { part: culprit, kind: "off" } : null;
}
