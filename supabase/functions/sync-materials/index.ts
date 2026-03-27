// Supabase Edge Function: sync-materials
// Fetches materials from Airtable and upserts into the Supabase materials table.
// Deploy: supabase functions deploy sync-materials
// Schedule: add a pg_cron job or Supabase scheduled trigger to run daily at midnight UTC.
//
// Required env vars (set via `supabase secrets set`):
//   AIRTABLE_API_KEY    — Airtable personal access token
//   AIRTABLE_BASE_ID    — Airtable base ID (e.g. appXXXXXXXXXX)
//   AIRTABLE_TABLE_NAME — Name of the table in Airtable (e.g. "Materials")
//   SUPABASE_URL        — Injected automatically by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — Injected automatically by Supabase
//   TENANT_ID           — UUID of the tenant to sync materials for (Helions Forge tenant id)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface AirtableRecord {
  id: string;
  fields: {
    Name?: string;
    Unit?: string;
    Rate?: number;
    [key: string]: unknown;
  };
}

interface AirtableResponse {
  records: AirtableRecord[];
  offset?: string;
}

async function fetchAllAirtableRecords(
  apiKey: string,
  baseId: string,
  tableName: string
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
    );
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable API error ${res.status}: ${body}`);
    }

    const data: AirtableResponse = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

Deno.serve(async () => {
  const airtableApiKey = Deno.env.get('AIRTABLE_API_KEY');
  const airtableBaseId = Deno.env.get('AIRTABLE_BASE_ID');
  const airtableTableName = Deno.env.get('AIRTABLE_TABLE_NAME') ?? 'Materials';
  const tenantId = Deno.env.get('TENANT_ID');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!airtableApiKey || !airtableBaseId || !tenantId) {
    return new Response(
      JSON.stringify({ error: 'Missing required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, TENANT_ID' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let records: AirtableRecord[];
  try {
    records = await fetchAllAirtableRecords(airtableApiKey, airtableBaseId, airtableTableName);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Airtable fetch failed: ${err instanceof Error ? err.message : err}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const now = new Date().toISOString();
  const upsertRows = records
    .filter((r) => r.fields.Name && r.fields.Unit && r.fields.Rate != null)
    .map((r) => ({
      tenant_id: tenantId,
      name: r.fields.Name as string,
      unit: r.fields.Unit as string,
      rate_gbp: r.fields.Rate as number,
      updated_at: now,
    }));

  if (upsertRows.length === 0) {
    return new Response(
      JSON.stringify({ message: 'No valid records found in Airtable', synced: 0 }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Upsert by (tenant_id, name) — requires a unique constraint on (tenant_id, name)
  // Add to Supabase: ALTER TABLE materials ADD CONSTRAINT materials_tenant_name_unique UNIQUE (tenant_id, name);
  const { error: upsertError } = await supabase
    .from('materials')
    .upsert(upsertRows, { onConflict: 'tenant_id,name' });

  if (upsertError) {
    return new Response(
      JSON.stringify({ error: `Supabase upsert failed: ${upsertError.message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ message: 'Sync complete', synced: upsertRows.length }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
