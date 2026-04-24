-- 0010: rescope the GitHub OAuth + wipe users for the re-auth wave.
--
-- We're adding `read:org` to the OAuth scopes (auth.ts) and rewriting
-- the worker's GitHub fetch to use `/user/repos?affiliation=...&visibility=all`,
-- GraphQL `contributionsCollection`, and commit search. All of that
-- only works if the user re-consents with the expanded scope.
--
-- Since there are zero live users at this point, the cleanest path is
-- to wipe auth state + anything downstream that was derived from
-- partial-data scans. Users will reconnect on next visit and the full-
-- access pipeline runs from scratch.
--
-- Wipe order matters — children first so FKs don't complain.

-- Notifications reference scans.
DELETE FROM notifications;

-- Push subscriptions reference users.
DELETE FROM push_subscriptions;

-- Claim pipeline outputs (legacy).
DELETE FROM claims;

-- Intake rows for unfinished onboardings.
DELETE FROM intake_sessions;

-- All scans — these were produced from incomplete data. New scans will
-- be triggered after users reconnect with the expanded scope.
DELETE FROM scan_events;
DELETE FROM scans;

-- User-facing profile rows — will be regenerated post-rescope.
DELETE FROM user_profiles;

-- Dodo subscription mirrors (billing work lives in 0008).
DELETE FROM subscription;

-- Auth: sessions + OAuth accounts + unused verifications. This is the
-- piece that actually forces re-consent.
DELETE FROM session;
DELETE FROM account;
DELETE FROM verification;

-- Users last — FK targets everywhere above.
DELETE FROM users;
