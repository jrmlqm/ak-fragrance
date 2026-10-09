-- ════════════════════════════════════════════════════════════════
-- AK Fragrance — Suppression des anciennes règles d'accès ouvertes
-- À exécuter UNE FOIS dans Supabase > SQL Editor, APRÈS admin_policies.sql.
--
-- Des règles créées au début du projet laissaient encore n'importe qui
-- modifier produits, maisons et images, ce qui annulait la protection
-- admin. Ce script les supprime et ne garde que :
--   • "Public read"  : tout le monde peut lire le catalogue
--   • "Admin write"  : seul le compte admin peut modifier
--   • "Admin upload/update/delete" : seul l'admin peut gérer les images
-- Les images restent visibles sur le site (le bucket est public).
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE p record;
BEGIN
  -- Tables du catalogue
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('products', 'brands', 'settings')
      AND policyname NOT IN ('Public read', 'Admin write')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    RAISE NOTICE 'Règle supprimée : % (table %)', p.policyname, p.tablename;
  END LOOP;

  -- Stockage des images : règles d'écriture qui ne sont pas les nôtres
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND policyname NOT IN ('Admin upload', 'Admin update', 'Admin delete')
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
    RAISE NOTICE 'Règle de stockage supprimée : %', p.policyname;
  END LOOP;
END $$;

-- Vérification : liste des règles restantes
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE (schemaname = 'public' AND tablename IN ('products', 'brands', 'settings'))
   OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY schemaname, tablename, policyname;
