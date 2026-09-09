-- Controls which payment method a discount actually reduces —
-- previously always applied to both regardless of method.
ALTER TABLE discount_codes ADD COLUMN applies_to TEXT NOT NULL DEFAULT 'both';
