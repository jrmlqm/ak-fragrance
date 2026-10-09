-- ════════════════════════════════════════════════════════════════
-- AK Fragrance — Autoriser les prix avec centimes (ex : 0,50 €)
-- À exécuter UNE FOIS dans Supabase > SQL Editor.
--
-- Passe en décimal (2 chiffres après la virgule) toutes les colonnes
-- de prix encore en nombre entier. Les prix existants sont conservés
-- tels quels (120 devient 120.00). Sans effet si déjà fait.
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('integer', 'bigint', 'smallint')
      AND (table_name, column_name) IN (
        ('products',   'price'),
        ('products',   'promo_price'),
        ('cart_items', 'price'),
        ('favorites',  'price'),
        ('orders',     'subtotal'),
        ('orders',     'delivery_cost'),
        ('orders',     'promo_discount'),
        ('orders',     'total')
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(10,2)', c.table_name, c.column_name);
    RAISE NOTICE 'Colonne %.% passée en décimal', c.table_name, c.column_name;
  END LOOP;
END $$;
