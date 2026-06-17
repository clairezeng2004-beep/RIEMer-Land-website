-- ============================================================
-- 相册上传修复 SQL（幂等，可重复执行）
-- 用途：
--   1. 补齐前端当前会写入的缩略图/原文件名字段；
--   2. 确保 album-photos bucket 公开读；
--   3. 重建 Storage 基础策略，避免上传/下载/删除权限不一致。
-- ============================================================

ALTER TABLE public.album_photos ADD COLUMN IF NOT EXISTS thumb_url TEXT;
ALTER TABLE public.album_photos ADD COLUMN IF NOT EXISTS thumb_path TEXT;
ALTER TABLE public.album_photos ADD COLUMN IF NOT EXISTS original_name TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('album-photos', 'album-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "album_photos_public_read" ON storage.objects;
CREATE POLICY "album_photos_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'album-photos');

DROP POLICY IF EXISTS "album_photos_auth_upload" ON storage.objects;
CREATE POLICY "album_photos_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'album-photos');

DROP POLICY IF EXISTS "album_photos_owner_update" ON storage.objects;
CREATE POLICY "album_photos_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'album-photos'
    AND (
      owner = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
    )
  );

DROP POLICY IF EXISTS "album_photos_owner_delete" ON storage.objects;
CREATE POLICY "album_photos_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'album-photos'
    AND (
      owner = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
    )
  );

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
