-- ============================================================
-- 相册功能最小可执行 SQL（独立于其他模块，贴进 Supabase 跑一次即可）
-- 跑完后前端新建相册就能持久化、刷新不丢
-- ============================================================

-- 1. 相册主表
CREATE TABLE IF NOT EXISTS public.albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  date TEXT DEFAULT '',
  cover_index INT DEFAULT 0,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_albums_date ON public.albums(date DESC);

-- 2. 相册照片表
CREATE TABLE IF NOT EXISTS public.album_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_path TEXT,
  thumb_url TEXT,
  thumb_path TEXT,
  original_name TEXT,
  caption TEXT DEFAULT '',
  sort_index INT DEFAULT 0,
  uploaded_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_album_photos_album_id ON public.album_photos(album_id);
CREATE INDEX IF NOT EXISTS idx_album_photos_sort ON public.album_photos(album_id, sort_index);

ALTER TABLE public.album_photos ADD COLUMN IF NOT EXISTS thumb_url TEXT;
ALTER TABLE public.album_photos ADD COLUMN IF NOT EXISTS thumb_path TEXT;
ALTER TABLE public.album_photos ADD COLUMN IF NOT EXISTS original_name TEXT;

-- 3. 开启 RLS
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.album_photos ENABLE ROW LEVEL SECURITY;

-- 4. albums 策略
DROP POLICY IF EXISTS "albums_select_auth" ON public.albums;
CREATE POLICY "albums_select_auth" ON public.albums
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "albums_insert_auth" ON public.albums;
CREATE POLICY "albums_insert_auth" ON public.albums
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "albums_update_owner_or_admin" ON public.albums;
CREATE POLICY "albums_update_owner_or_admin" ON public.albums
  FOR UPDATE TO authenticated
  USING (
    created_by_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
  );

DROP POLICY IF EXISTS "albums_delete_owner_or_admin" ON public.albums;
CREATE POLICY "albums_delete_owner_or_admin" ON public.albums
  FOR DELETE TO authenticated
  USING (
    created_by_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
  );

-- 5. album_photos 策略
DROP POLICY IF EXISTS "album_photos_select_auth" ON public.album_photos;
CREATE POLICY "album_photos_select_auth" ON public.album_photos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "album_photos_insert_auth" ON public.album_photos;
CREATE POLICY "album_photos_insert_auth" ON public.album_photos
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "album_photos_update_uploader_or_admin" ON public.album_photos;
CREATE POLICY "album_photos_update_uploader_or_admin" ON public.album_photos
  FOR UPDATE TO authenticated
  USING (
    uploaded_by_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
    OR EXISTS (SELECT 1 FROM public.albums a WHERE a.id = album_id AND a.created_by_id = auth.uid())
  );

DROP POLICY IF EXISTS "album_photos_delete_uploader_or_admin" ON public.album_photos;
CREATE POLICY "album_photos_delete_uploader_or_admin" ON public.album_photos
  FOR DELETE TO authenticated
  USING (
    uploaded_by_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
    OR EXISTS (SELECT 1 FROM public.albums a WHERE a.id = album_id AND a.created_by_id = auth.uid())
  );

-- 6. realtime 发布
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.albums;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.album_photos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7. Storage bucket（公开读）
INSERT INTO storage.buckets (id, name, public)
VALUES ('album-photos', 'album-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 8. Storage 策略
DROP POLICY IF EXISTS "album_photos_public_read" ON storage.objects;
CREATE POLICY "album_photos_public_read" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'album-photos');

DROP POLICY IF EXISTS "album_photos_auth_upload" ON storage.objects;
CREATE POLICY "album_photos_auth_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'album-photos');

DROP POLICY IF EXISTS "album_photos_owner_update" ON storage.objects;
CREATE POLICY "album_photos_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'album-photos'
    AND (owner = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner'))
  );

DROP POLICY IF EXISTS "album_photos_owner_delete" ON storage.objects;
CREATE POLICY "album_photos_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'album-photos'
    AND (owner = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner'))
  );

-- 9. 快速相册列表：数据库端一次性返回相册 + 封面 + 数量
CREATE OR REPLACE FUNCTION public.get_album_list_fast()
RETURNS TABLE (
  album_id UUID,
  title TEXT,
  description TEXT,
  date TEXT,
  cover_index INT,
  created_by_id UUID,
  created_by TEXT,
  created_at TIMESTAMPTZ,
  photo_count BIGINT,
  cover_id UUID,
  cover_url TEXT,
  cover_storage_path TEXT,
  cover_thumb_url TEXT,
  cover_thumb_path TEXT,
  cover_original_name TEXT,
  cover_caption TEXT,
  cover_sort_index INT,
  cover_uploaded_by_id UUID
)
LANGUAGE sql
STABLE
AS $$
  WITH photo_counts AS (
    SELECT album_id, COUNT(*)::BIGINT AS photo_count
    FROM public.album_photos
    GROUP BY album_id
  ),
  cover_photos AS (
    SELECT DISTINCT ON (p.album_id)
      p.album_id,
      p.id,
      p.url,
      p.storage_path,
      p.thumb_url,
      p.thumb_path,
      p.original_name,
      p.caption,
      p.sort_index,
      p.uploaded_by_id
    FROM public.album_photos p
    ORDER BY p.album_id, p.sort_index ASC, p.created_at ASC
  )
  SELECT
    a.id AS album_id,
    a.title,
    a.description,
    a.date,
    a.cover_index,
    a.created_by_id,
    a.created_by,
    a.created_at,
    COALESCE(pc.photo_count, 0)::BIGINT AS photo_count,
    cp.id AS cover_id,
    cp.url AS cover_url,
    cp.storage_path AS cover_storage_path,
    cp.thumb_url AS cover_thumb_url,
    cp.thumb_path AS cover_thumb_path,
    cp.original_name AS cover_original_name,
    cp.caption AS cover_caption,
    cp.sort_index AS cover_sort_index,
    cp.uploaded_by_id AS cover_uploaded_by_id
  FROM public.albums a
  LEFT JOIN photo_counts pc ON pc.album_id = a.id
  LEFT JOIN cover_photos cp ON cp.album_id = a.id
  ORDER BY a.date DESC, a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_album_list_fast() TO authenticated;

-- 完成 ✅
