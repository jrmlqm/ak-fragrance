-- ════════════════════════════════════════════════════════════════
-- AK Fragrance — Sécurisation de l'administration
-- À exécuter UNE FOIS dans Supabase > SQL Editor.
--
-- Avant : n'importe qui possédant la clé publique du site pouvait
-- modifier produits / maisons / réglages. Après : lecture publique,
-- écriture réservée aux comptes listés dans is_admin().
--
-- IMPORTANT : créez d'abord le compte admin (inscription sur le site
-- avec akfragrance75@gmail.com) AVANT d'exécuter ce script, et
-- gardez la confirmation d'email activée dans Supabase > Auth.
-- ════════════════════════════════════════════════════════════════

-- Colonnes / table utilisées par l'admin (sans effet si déjà présentes)
ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_price INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sizes JSONB DEFAULT '[]';
ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT FALSE;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS image_url TEXT;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

-- Liste des administrateurs (garder synchronisée avec ADMIN_EMAILS
-- dans app.js et admin.html)
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', '')) IN (
    'akfragrance75@gmail.com'
  );
$$;

-- ── Tables products, brands, settings ──
-- 1) Vérifiez dans Database > Policies s'il reste d'autres règles
--    d'écriture permissives (ex. « Enable insert for all ») sur ces
--    tables et supprimez-les : elles annuleraient la protection.
DROP POLICY IF EXISTS "Anon write" ON settings;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','brands','settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Public read" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin write" ON %I', t);
    EXECUTE format('CREATE POLICY "Public read" ON %I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY "Admin write" ON %I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', t);
  END LOOP;
END $$;

-- ── Stockage des images (bucket Ak_Fragrance) ──
-- Même remarque : supprimez les anciennes règles d'upload ouvertes à tous
-- dans Storage > Policies.
DROP POLICY IF EXISTS "Admin upload" ON storage.objects;
DROP POLICY IF EXISTS "Admin update" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete" ON storage.objects;
CREATE POLICY "Admin upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'Ak_Fragrance' AND public.is_admin());
CREATE POLICY "Admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'Ak_Fragrance' AND public.is_admin());
CREATE POLICY "Admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'Ak_Fragrance' AND public.is_admin());
