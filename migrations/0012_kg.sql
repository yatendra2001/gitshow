-- 0012_kg.sql — Knowledge Graph + LinkedIn PDF columns.
--
-- Pure additive migration:
--   - users.discoverable: opt-in flag for future recruiter JD-matching.
--   - scans.kg_r2_key: pointer to the KG snapshot in R2 (kg/{handle}/scan-{id}.json).
--   - scans.linkedin_pdf_text: extracted text from a user-uploaded LinkedIn PDF.
--
-- No data migration risk; all columns nullable or defaulted.

ALTER TABLE users ADD COLUMN discoverable INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scans ADD COLUMN kg_r2_key TEXT;

ALTER TABLE scans ADD COLUMN linkedin_pdf_text TEXT;
