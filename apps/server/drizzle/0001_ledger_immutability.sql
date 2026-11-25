-- Defter değişmezliği veritabanı düzeyinde: satırlar yalnızca eklenir, işlem toplamı sıfırdır, sözleşme koşulları dondurulur.
CREATE OR REPLACE FUNCTION cf.forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cf.% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON cf.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION cf.forbid_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON cf.ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION cf.forbid_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON cf.ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION cf.forbid_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_no_truncate BEFORE TRUNCATE ON cf.ledger_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION cf.forbid_ledger_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cf.forbid_contract_terms_change() RETURNS trigger AS $$
BEGIN
  IF OLD.terms IS NOT NULL AND NEW.terms IS DISTINCT FROM OLD.terms THEN
    RAISE EXCEPTION 'cf.contracts.terms is frozen once set' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contracts_terms_frozen BEFORE UPDATE ON cf.contracts
  FOR EACH ROW EXECUTE FUNCTION cf.forbid_contract_terms_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cf.check_ledger_tx_balanced() RETURNS trigger AS $$
DECLARE s numeric;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO s FROM cf.ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF s <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (sum %)', NEW.transaction_id, s USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON cf.ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cf.check_ledger_tx_balanced();
