-- 公众号文章封面 Storage bucket
-- 目的：封面图不再以 base64 Data URL 存入 articles.cover_image，
-- 避免手机端因大 data URL 解码/同步不稳定而显示破图。

INSERT INTO storage.buckets (id, name, public)
VALUES ('article-covers', 'article-covers', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "article_covers_public_read" ON storage.objects;
CREATE POLICY "article_covers_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'article-covers');

DROP POLICY IF EXISTS "article_covers_auth_upload" ON storage.objects;
CREATE POLICY "article_covers_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'article-covers');

DROP POLICY IF EXISTS "article_covers_auth_update" ON storage.objects;
CREATE POLICY "article_covers_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'article-covers')
  WITH CHECK (bucket_id = 'article-covers');

DROP POLICY IF EXISTS "article_covers_auth_delete" ON storage.objects;
CREATE POLICY "article_covers_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'article-covers');
