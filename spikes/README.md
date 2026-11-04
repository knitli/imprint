# Spikes

Throwaway experiments that answer one question each. The plan, and the results so far, are in [`docs/research/README.md`](../docs/research/README.md).

Rules for spikes:

- **Synthetic data only.** Use the examples that ship with OpenSCG, or invent your own and label them.
- Each spike has its own folder, its own `package.json` (or equivalent) and a short `README.md` saying the question, how to run it and what it found.
- Spike code is not product code. Do not import it from the application; rewrite what you keep.
- Pin dependency versions exactly, so a result can be reproduced.
