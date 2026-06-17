-- ============================================================
-- RIEMer Land - 通讯录 + 相册 一键升级 SQL
-- 执行位置: Supabase Dashboard -> SQL Editor -> New Query -> 全选粘贴 -> Run
-- 特点:
--   * 完全幂等：重复执行不会报错（IF NOT EXISTS / DROP POLICY IF EXISTS / DO $$ 块）
--   * 独立自包含：不依赖 supabase-fix.sql / supabase-setup.sql 里的其它模块
--   * 不会触发历史遗留对象（如 is_pre_authorized 相关错误）
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PART A: 成员通讯录 member_profiles
-- ════════════════════════════════════════════════════════════

-- A1. 建表（如果已存在则跳过，列通过后面的 ALTER 补齐）
CREATE TABLE IF NOT EXISTS public.member_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enrollment_year TEXT DEFAULT '',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  bio TEXT DEFAULT '',
  further_education TEXT DEFAULT '',
  career TEXT DEFAULT '',
  willing_to_share TEXT DEFAULT '',
  want_to_learn TEXT DEFAULT '',
  career_interest TEXT DEFAULT '',
  hometown TEXT DEFAULT '',
  dream_city TEXT DEFAULT '',
  hobbies TEXT DEFAULT '',
  favorites TEXT DEFAULT '',
  other TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- A2. 为"已经存在的旧表"补齐所有列（幂等）
DO $$
DECLARE
  col_name TEXT;
  col_type TEXT;
  cols TEXT[][] := ARRAY[
    ['enrollment_year','TEXT'],
    ['joined_at','TIMESTAMPTZ'],
    ['bio','TEXT'],
    ['further_education','TEXT'],
    ['career','TEXT'],
    ['willing_to_share','TEXT'],
    ['want_to_learn','TEXT'],
    ['career_interest','TEXT'],
    ['hometown','TEXT'],
    ['dream_city','TEXT'],
    ['hobbies','TEXT'],
    ['favorites','TEXT'],
    ['other','TEXT'],
    ['created_at','TIMESTAMPTZ'],
    ['updated_at','TIMESTAMPTZ']
  ];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(cols, 1) LOOP
    col_name := cols[i][1];
    col_type := cols[i][2];
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'member_profiles'
        AND column_name = col_name
    ) THEN
      IF col_type = 'TEXT' THEN
        EXECUTE format('ALTER TABLE public.member_profiles ADD COLUMN %I TEXT DEFAULT %L', col_name, '');
      ELSE
        EXECUTE format('ALTER TABLE public.member_profiles ADD COLUMN %I TIMESTAMPTZ DEFAULT NOW()', col_name);
      END IF;
      RAISE NOTICE '✅ 已添加 member_profiles.% 列', col_name;
    END IF;
  END LOOP;
END $$;

-- A3. 开启 RLS
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;

-- A4. 清理可能存在的所有旧策略（包括中/英文名）
DROP POLICY IF EXISTS "所有认证用户可查看成员信息" ON public.member_profiles;
DROP POLICY IF EXISTS "匿名用户可查看成员信息" ON public.member_profiles;
DROP POLICY IF EXISTS "用户可更新自己的成员信息" ON public.member_profiles;
DROP POLICY IF EXISTS "管理员可更新所有成员信息" ON public.member_profiles;
DROP POLICY IF EXISTS "用户可插入自己的成员信息" ON public.member_profiles;
DROP POLICY IF EXISTS "member_profiles_select_all" ON public.member_profiles;
DROP POLICY IF EXISTS "member_profiles_insert_self" ON public.member_profiles;
DROP POLICY IF EXISTS "member_profiles_update_self" ON public.member_profiles;
DROP POLICY IF EXISTS "member_profiles_update_admin" ON public.member_profiles;
DROP POLICY IF EXISTS "member_profiles_delete_admin" ON public.member_profiles;

-- A5. 重建策略
-- 任何人（含匿名）可查看（供"关于我们"等公共页面使用）
CREATE POLICY "member_profiles_select_all"
  ON public.member_profiles FOR SELECT
  TO public
  USING (true);

-- 用户可插入自己的记录
CREATE POLICY "member_profiles_insert_self"
  ON public.member_profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 用户可更新自己的记录
CREATE POLICY "member_profiles_update_self"
  ON public.member_profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 管理员/所有者可更新所有记录
CREATE POLICY "member_profiles_update_admin"
  ON public.member_profiles FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
  );

-- 管理员/所有者可删除记录
CREATE POLICY "member_profiles_delete_admin"
  ON public.member_profiles FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
  );

-- A6. 新用户授权时自动创建 member_profiles 行
CREATE OR REPLACE FUNCTION public.handle_new_member_profile()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.authorized = true AND (OLD.authorized IS NULL OR OLD.authorized = false) THEN
    INSERT INTO public.member_profiles (user_id, joined_at)
    VALUES (NEW.id, COALESCE(NEW.created_at, now()))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_authorized ON public.profiles;
CREATE TRIGGER on_profile_authorized
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_member_profile();

-- A7. 为已有的已授权用户补建记录（幂等）
INSERT INTO public.member_profiles (user_id, joined_at)
SELECT id, created_at FROM public.profiles WHERE authorized = true
ON CONFLICT (user_id) DO NOTHING;

-- A8. realtime 发布（如果用到）
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.member_profiles;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- PART B: 相册 albums + album_photos
-- ════════════════════════════════════════════════════════════

-- B1. 相册主表
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

-- B2. 相册照片表
CREATE TABLE IF NOT EXISTS public.album_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_path TEXT,
  caption TEXT DEFAULT '',
  sort_index INT DEFAULT 0,
  uploaded_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_album_photos_album_id ON public.album_photos(album_id);
CREATE INDEX IF NOT EXISTS idx_album_photos_sort ON public.album_photos(album_id, sort_index);

-- B3. 开启 RLS
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.album_photos ENABLE ROW LEVEL SECURITY;

-- B4. albums 策略
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

-- B5. album_photos 策略
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

-- B6. realtime 发布
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.albums;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.album_photos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- PART C: 相册图片 Storage bucket
-- ════════════════════════════════════════════════════════════

-- C1. bucket（公开读）
INSERT INTO storage.buckets (id, name, public)
VALUES ('album-photos', 'album-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- C2. Storage 策略
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


-- ════════════════════════════════════════════════════════════
-- PART D: album_photos 增量字段（缩略图 + 原始文件名）
-- 首次执行会自动添加；重复执行不会报错
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE
  col_name TEXT;
  cols TEXT[] := ARRAY['thumb_url','thumb_path','original_name'];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(cols, 1) LOOP
    col_name := cols[i];
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'album_photos'
        AND column_name = col_name
    ) THEN
      EXECUTE format('ALTER TABLE public.album_photos ADD COLUMN %I TEXT', col_name);
      RAISE NOTICE '✅ 已添加 album_photos.% 列', col_name;
    END IF;
  END LOOP;
END $$;


-- ════════════════════════════════════════════════════════════
-- PART E: 快速相册列表 RPC（相册 + 封面 + 数量）
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- 完成 ✅
--   如果你看到 "Success. No rows returned" 就全部成功
--   警告 (NOTICE) 如 "xxx 列已存在，跳过" 是正常的
-- ════════════════════════════════════════════════════════════
