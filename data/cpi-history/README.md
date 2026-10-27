# CPI historical extension (1860–1912)

`measuringworth-1860-1913.json` preserves the annual CPI levels retrieved from
MeasuringWorth on 2026-10-27, including 1913 as the overlap anchor. Its source URL,
citation and downloaded HTML hash are recorded in the file. The source is an
economic-history reconstruction, not official monthly BLS observations.

Reproduce locally with `npx tsx script/extend-cpi-history.ts` from the repository
root. The script adds 53 annual observations (dated January 1 as a year label),
using `historical CPI × (mean of 12 stored BLS CPI months in 1913 / 9.60)`.
The factor is approximately 1.029513888889. It does not calculate YoY changes or
fill monthly gaps. Official observations from January 1913 remain unchanged.
This is our splice, not MeasuringWorth's complete modern series.

Provenance and preservation hashes are in
`client/src/data/cpi-history-audit.json`. The usual monthly refresh merges modern
observations and retains this historical prefix. CPI-derived purchasing power
inherits the annual observations; inflation and real-rate input series do not.

The chart uses annual dashed guides, a 1913 source boundary and source notes.
Small changes across that boundary may reflect source differences. Annual
observations cannot identify within-year turning points. Source use is credited
to MeasuringWorth; its website permits non-profit educational use with credit
and directs other uses to its permission process.

No insight documents, database records or production deployments are part of
this extension.
