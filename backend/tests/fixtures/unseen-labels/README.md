# Unseen-label pair

Neither document uses a label from the extractor's synonym table, and the two
documents share no label vocabulary with each other. Deterministic rules return
`FIELD_NOT_FOUND` for all seven fields on both sides, which is what routes the
pair to the Gemini readable-text fallback.

The fallback returns each value with a verbatim quote that the backend verifies
against the extracted source text before the value is accepted, so a value that
the model cannot point at in the source is rejected rather than trusted.

An earlier draft of this pair used `Taken In Charge At` and `Place Of Delivery
By Carrier` on the BL. The fallback correctly refused to equate those with the
sea ports — under multimodal carriage a place of receipt or delivery is not the
port of loading or discharge — so the wording was changed to keep the fixture
about unseen labels rather than a genuine semantic trap.

One real discrepancy is planted: `Box Tally: 6 x 40'HC` against
`Equipment Quantity: 7 x 40'HC`. Everything else matches. A correct run reports
exactly one discrepancy, `container_count`, with SI 6 and BL 7.
