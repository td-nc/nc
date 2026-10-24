-- v1.2: segnalazione StudioLAB (Prest_Messaggi) collegata alla NC
ALTER TABLE nc ADD COLUMN IF NOT EXISTS lis_segnalazione_id TEXT;
ALTER TABLE nc ADD COLUMN IF NOT EXISTS lis_segnalazione_esito TEXT;
