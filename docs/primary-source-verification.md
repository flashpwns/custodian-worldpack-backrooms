# Primary-source verification

YB-3 records only source facts that a reviewer can find again from a stable official locator. A verified primary record contains the exact upload title, creator, publisher, durable URL, source-page publication time, normalized UTC date, direct-check flag, transcript-assistance flag, and one or more scene or metadata locators.

`directly_checked` means a reviewer inspected the official upload or its official metadata. `transcript_assisted` records whether a transcript was used only to navigate; it never substitutes for scene verification. Yellow Beast stores neither transcript text nor media.

## Worked example: First Contact to Threshold Baseline

1. `verified-first-contact` points to Kane Pixels' official upload at `https://www.youtube.com/watch?v=eXdIDjzy6KY`.
2. The official metadata and source material were checked directly; the intake record declares no transcript assistance.
3. `first-contact-staffed-apparatus` preserves the bounded `00:00:40–00:01:10` scene locator and an analytical description of only what is visible.
4. `first-contact-depicts-staffed-threshold-apparatus` records that observation, completes the review lifecycle, and is admitted as authoritative at that narrow scope.
5. `threshold-baseline-admission.json` uses the claim to qualify its controlled Threshold-side premise. It still separately declares its compact layout and exact action/resource representation as pack-original.

This process does **not** establish Threshold physics, universal access rules, organizational intent, or a complete setting chronology.

## Institutional and secondary material

An in-fiction document can establish that an institution made an assertion. It cannot establish objective truth without separate admissible support. Community transcripts and wikis may help a reviewer locate an official source, but claims rooted only in secondary material stay reference-only, prohibited, or unresolved.

Production images remain production artifacts even when creator-authored. Repetition by secondary sources does not increase a claim's authority.

## Admission checklist

1. Confirm project scope and provenance.
2. Record an official, stable locator and exact metadata.
3. Directly inspect the cited timestamp, frame range, title card, document, or official description.
4. Write a short paraphrase that does not exceed the observed evidence.
5. Record transcript assistance separately, if any.
6. Link qualification or conflict records rather than flattening disagreement.
7. Admit only the narrow authority supported by the locator.
8. Keep simulation conveniences explicitly `pack-original`.
9. Run `npm run validate-assets`, `npm run validate-contracts`, `npm run check-admission`, and `npm run evidence-report`.
