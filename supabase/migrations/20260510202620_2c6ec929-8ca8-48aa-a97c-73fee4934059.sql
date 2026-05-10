
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text NOT NULL,
  import_type text NOT NULL,
  file_name text,
  imported_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  is_demo boolean NOT NULL DEFAULT false,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_batches_user ON public.import_batches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batch_items_batch ON public.import_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_batch_items_user_table ON public.import_batch_items(user_id, table_name);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own import batches select" ON public.import_batches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own import batches insert" ON public.import_batches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own import batches update" ON public.import_batches FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Own import batches delete" ON public.import_batches FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Own import items select" ON public.import_batch_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own import items insert" ON public.import_batch_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own import items delete" ON public.import_batch_items FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_import_batches_updated_at
  BEFORE UPDATE ON public.import_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
