const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const storageBuckets = {
  gallery: 'jci-gallery',
  partners: 'jci-partners'
};

function publicStorageUrl(bucket, storagePath) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

module.exports = { supabase, storageBuckets, publicStorageUrl };
