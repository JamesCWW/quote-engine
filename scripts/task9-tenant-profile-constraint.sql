-- Add unique constraint on tenant_profile.tenant_id so ON CONFLICT upserts work
ALTER TABLE tenant_profile
ADD CONSTRAINT tenant_profile_tenant_id_unique
UNIQUE (tenant_id);
