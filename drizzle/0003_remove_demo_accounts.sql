DO $$
DECLARE
  referenced_code varchar(20);
BEGIN
  SELECT demo."code"
  INTO referenced_code
  FROM "chart_of_accounts" AS demo
  WHERE (demo."code", demo."name") IN (VALUES
    ('1000', 'Cash'),
    ('1200', 'Accounts Receivable'),
    ('2000', 'Accounts Payable'),
    ('2100', 'VAT Payable'),
    ('4000', 'Operating Expenses'),
    ('4100', 'Office Supplies'),
    ('4200', 'Professional Services'),
    ('4300', 'Travel & Entertainment'),
    ('5000', 'Revenue')
  )
    AND EXISTS (
      SELECT 1
      FROM "supplier_invoices"
      WHERE "supplier_invoices"."expense_account_id" = demo."id"
    )
  ORDER BY demo."code"
  LIMIT 1;

  IF referenced_code IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot remove demo chart of accounts code % because it is referenced by an invoice.', referenced_code
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT demo."code"
  INTO referenced_code
  FROM "chart_of_accounts" AS demo
  WHERE (demo."code", demo."name") IN (VALUES
    ('1000', 'Cash'),
    ('1200', 'Accounts Receivable'),
    ('2000', 'Accounts Payable'),
    ('2100', 'VAT Payable'),
    ('4000', 'Operating Expenses'),
    ('4100', 'Office Supplies'),
    ('4200', 'Professional Services'),
    ('4300', 'Travel & Entertainment'),
    ('5000', 'Revenue')
  )
    AND EXISTS (
      SELECT 1
      FROM "chart_of_accounts" AS child
      WHERE child."parent_id" = demo."id"
    )
  ORDER BY demo."code"
  LIMIT 1;

  IF referenced_code IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot remove demo chart of accounts code % because it is referenced by a child account.', referenced_code
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END $$;
--> statement-breakpoint
DELETE FROM "chart_of_accounts"
WHERE ("code", "name") IN (VALUES
  ('1000', 'Cash'),
  ('1200', 'Accounts Receivable'),
  ('2000', 'Accounts Payable'),
  ('2100', 'VAT Payable'),
  ('4000', 'Operating Expenses'),
  ('4100', 'Office Supplies'),
  ('4200', 'Professional Services'),
  ('4300', 'Travel & Entertainment'),
  ('5000', 'Revenue')
);
