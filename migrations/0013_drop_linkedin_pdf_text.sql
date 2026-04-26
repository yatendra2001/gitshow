-- Migration 0013: drop scans.linkedin_pdf_text
--
-- Added in 0012 for the LinkedIn PDF salvage tier. The PDF tier was
-- retired in favour of the Gemini grounded fallback (see the
-- LinkedIn rework in the per-repo grounding PR), so this column is
-- no longer read or written. We have zero users — safe to drop.

ALTER TABLE scans DROP COLUMN linkedin_pdf_text;
