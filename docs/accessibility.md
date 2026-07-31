# Accessibility and player preferences

YB-30 Pass 5 adds global desktop presentation preferences: appearance
(including high contrast), text size, reduced motion, and Guided
Introductions. They are stored in the existing desktop settings file, never in
world history or observer knowledge. Reset restores only presentation defaults.

Reduced motion uses the Pass-3 motion seam and the browser reduced-motion
preference. Text sizes are bounded at Small, Default, Large, and Extra Large.
High contrast preserves each mode through headings and layout rather than color
alone. Focus is visible on controls and summaries; native forms/details keep a
logical keyboard order. `?` opens recap and Escape closes it outside text
entry, without submitting or cancelling a turn.

The renderer uses a bounded polite status region for observer-safe application
feedback and a semantic current-scene heading. Pins expose pressed state and
named controls; no other-observer, debug, hidden-fate, or hidden-taxonomy data
is added to the player accessibility tree. Lost has the same sparse safe
information in keyboard and assistive-tech paths.

Guided Introductions remain guidance only. Toggling them changes future
presentation context, not a world, phase consequence, inventory, actor, or
history. Narration density is deferred: no safe existing presentation-density
seam currently changes wording without risking a divergent factual surface.
Pass 6 validates the complete UX milestone with reduced motion, maximum text
scale, high-contrast, keyboard-only, and hidden-data coverage. These checks
change presentation only and keep Lost’s sparse observer-safe structure.
