# Backup & Restore Guide — TitanGrid Retail ERP

1. **Tenant JSON Export**: Navigate to `Settings & Vault` -> click **Download Full Tenant Backup (.JSON)** (`GET /api/security/backup`). Every backup event is logged in the immutable audit trail.
2. **SQLite WAL Snapshot**: For single-container deployments, stop writes or run SQLite online backup on `data/erp.db`:
   ```bash
   sqlite3 data/erp.db ".backup 'backups/erp_$(date +%F).db'"
   ```
3. **PostgreSQL Production Backups**: Use Cloud SQL automated daily backups with Point-in-Time Recovery (PITR) enabled, or `pg_dump --format=custom titangrid_erp > backup.dump`.
4. **Encrypted Vault Key**: Always back up `ERP_VAULT_KEY` securely in your secret manager; encrypted integration credentials require the same vault key upon restore.
