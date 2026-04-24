-- Billing: Dodo Payments subscription cache.
--
-- Why this table exists: `@dodopayments/better-auth` auto-creates the
-- customer on signup and handles checkout/portal/webhook verification,
-- but we still need a locally-queryable source of truth for the
-- `requirePro()` gate. Hitting the Dodo REST API on every request to
-- /app and every mutation endpoint would be slow + rate-limitable.
--
-- The webhook handler in auth.ts upserts rows here on:
--   - subscription.active / renewed   → status='active',  period_end=next_billing_date
--   - subscription.cancelled          → status='cancelled' but keep until period_end
--                                       (we configured "cancel at period end")
--   - subscription.on_hold            → status='on_hold'  (renewal payment failed)
--   - subscription.expired            → status='expired'  (term fully ended)
--   - subscription.plan_changed       → swap product_id + interval
--
-- `requirePro()` reads the latest row per user_id and allows through
-- when status IN ('active','cancelled','on_hold') AND period_end > now.
-- i.e. a cancelled user keeps access until their paid period expires.
--
-- No FK back to `users` on `customer_id` because Dodo's id lives in
-- Better Auth's `account` rows (plugin writes it there). We denormalize
-- to `user_id` for cheap joins from the rest of the app.

CREATE TABLE subscription (
  id                  TEXT NOT NULL PRIMARY KEY,   -- Dodo subscription_id (sub_xxx)
  user_id             TEXT NOT NULL,
  customer_id         TEXT NOT NULL,               -- Dodo customer_id (cust_xxx)
  product_id          TEXT NOT NULL,               -- pdt_xxx (monthly or yearly)
  status              TEXT NOT NULL,               -- active | cancelled | on_hold | expired | failed
  interval            TEXT,                        -- 'Month' | 'Year' (from payment_frequency_interval)
  amount_cents        INTEGER,                     -- recurring_pre_tax_amount (cents)
  currency            TEXT,                        -- 'USD'
  current_period_end  INTEGER NOT NULL,            -- epoch-ms, mirror of next_billing_date
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0, -- 1 if user requested cancel; access stays until period_end
  cancelled_at        INTEGER,                     -- epoch-ms when the cancel event landed
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_subscription_user_id  ON subscription(user_id);
CREATE INDEX idx_subscription_status   ON subscription(status);
CREATE INDEX idx_subscription_customer ON subscription(customer_id);
