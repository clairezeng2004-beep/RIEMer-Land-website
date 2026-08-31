-- 公众号文章封面 Storage（幂等，可重复执行）
-- 安全边界：
--   1. bucket 公开，已知 URL 可直接展示；不开放匿名对象列表查询。
--   2. 登录用户只能在以本人 user id 命名的一级目录中新增对象。
--   3. 对象更新和删除由 Storage 的 owner_id 限制为创建者本人。
--   4. 不修改 articles 表，不迁移或删除现有 cover_image 数据。

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'article-covers',
  'article-covers',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 清理本仓库旧版脚本曾使用的宽权限策略名称。
DROP POLICY IF EXISTS "article_covers_public_read" ON storage.objects;
DROP POLICY IF EXISTS "article_covers_auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "article_covers_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "article_covers_auth_delete" ON storage.objects;

DROP POLICY IF EXISTS "article_covers_auth_insert_own_folder" ON storage.objects;
CREATE POLICY "article_covers_auth_insert_own_folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'article-covers'
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
);

DROP POLICY IF EXISTS "article_covers_auth_select_own" ON storage.objects;
CREATE POLICY "article_covers_auth_select_own"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'article-covers'
  AND owner_id = (SELECT auth.uid()::text)
);

DROP POLICY IF EXISTS "article_covers_auth_update_own" ON storage.objects;
CREATE POLICY "article_covers_auth_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'article-covers'
  AND owner_id = (SELECT auth.uid()::text)
)
WITH CHECK (
  bucket_id = 'article-covers'
  AND owner_id = (SELECT auth.uid()::text)
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
);

DROP POLICY IF EXISTS "article_covers_auth_delete_own" ON storage.objects;
CREATE POLICY "article_covers_auth_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'article-covers'
  AND owner_id = (SELECT auth.uid()::text)
);
