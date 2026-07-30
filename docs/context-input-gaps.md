# Context input gaps

The closure audit found no untracked repository context. It did find three historically named inputs that are not present in this checkout:

- `archive-kane-facility-old-general` — archive/community material; needs the archive or provenance-bearing index.
- `kelowna-branch-image-gallery` — image/reference batch; needs gallery provenance and a bounded observation index.
- `transcript-overflow-reference` — transcript/source reference; needs an official locator or transcript provenance.

They are tracked as `missing-manual-input`, reference-only, and do not block YB-17. Yellow Beast must not infer their content or use them in simulation until supplied and reviewed.
