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
