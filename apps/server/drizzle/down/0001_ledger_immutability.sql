-- 0001_ledger_immutability geri alma
DROP TRIGGER IF EXISTS ledger_entries_balanced ON cf.ledger_entries;
DROP TRIGGER IF EXISTS contracts_terms_frozen ON cf.contracts;
DROP TRIGGER IF EXISTS ledger_transactions_no_truncate ON cf.ledger_transactions;
DROP TRIGGER IF EXISTS ledger_transactions_immutable ON cf.ledger_transactions;
DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON cf.ledger_entries;
DROP TRIGGER IF EXISTS ledger_entries_immutable ON cf.ledger_entries;
DROP FUNCTION IF EXISTS cf.check_ledger_tx_balanced();
DROP FUNCTION IF EXISTS cf.forbid_contract_terms_change();
DROP FUNCTION IF EXISTS cf.forbid_ledger_mutation();
DELETE FROM cf_migrations.migrations WHERE created_at = 1795600055200;
