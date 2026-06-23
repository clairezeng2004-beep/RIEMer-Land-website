-- ============================================================
-- 相册照片「点赞 + 评论」功能 SQL（独立，贴进 Supabase SQL Editor 跑一次即可）
-- 依赖：public.album_photos、public.profiles（已存在）
-- ============================================================

-- ============ 一、点赞 ============

-- 1. 点赞表：一个用户对一张照片最多点赞一次（唯一约束）
CREATE TABLE IF NOT EXISTS public.album_photo_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES public.album_photos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (photo_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_album_photo_likes_photo ON public.album_photo_likes(photo_id);
CREATE INDEX IF NOT EXISTS idx_album_photo_likes_user ON public.album_photo_likes(user_id);

ALTER TABLE public.album_photo_likes ENABLE ROW LEVEL SECURITY;

-- 所有登录用户都能看到点赞（用于显示数量与点赞人）
DROP POLICY IF EXISTS "album_photo_likes_select_auth" ON public.album_photo_likes;
CREATE POLICY "album_photo_likes_select_auth" ON public.album_photo_likes
  FOR SELECT TO authenticated USING (true);

-- 只能以自己的身份点赞（user_id 必须等于当前登录用户）
DROP POLICY IF EXISTS "album_photo_likes_insert_self" ON public.album_photo_likes;
CREATE POLICY "album_photo_likes_insert_self" ON public.album_photo_likes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- 只能取消自己的点赞
DROP POLICY IF EXISTS "album_photo_likes_delete_self" ON public.album_photo_likes;
CREATE POLICY "album_photo_likes_delete_self" ON public.album_photo_likes
  FOR DELETE TO authenticated USING (user_id = auth.uid());


-- ============ 二、评论 ============

-- 2. 评论表
CREATE TABLE IF NOT EXISTS public.album_photo_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES public.album_photos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name TEXT DEFAULT '',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_album_photo_comments_photo ON public.album_photo_comments(photo_id, created_at);

ALTER TABLE public.album_photo_comments ENABLE ROW LEVEL SECURITY;

-- 所有登录用户都能看评论
DROP POLICY IF EXISTS "album_photo_comments_select_auth" ON public.album_photo_comments;
CREATE POLICY "album_photo_comments_select_auth" ON public.album_photo_comments
  FOR SELECT TO authenticated USING (true);

-- 只能以自己的身份发表评论
DROP POLICY IF EXISTS "album_photo_comments_insert_self" ON public.album_photo_comments;
CREATE POLICY "album_photo_comments_insert_self" ON public.album_photo_comments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- 评论作者本人或管理员可删除评论
DROP POLICY IF EXISTS "album_photo_comments_delete_self_or_admin" ON public.album_photo_comments;
CREATE POLICY "album_photo_comments_delete_self_or_admin" ON public.album_photo_comments
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
  );


-- ============ 三、相册级点赞 ============

CREATE TABLE IF NOT EXISTS public.album_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (album_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_album_likes_album ON public.album_likes(album_id);
CREATE INDEX IF NOT EXISTS idx_album_likes_user ON public.album_likes(user_id);

ALTER TABLE public.album_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "album_likes_select_auth" ON public.album_likes;
CREATE POLICY "album_likes_select_auth" ON public.album_likes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "album_likes_insert_self" ON public.album_likes;
CREATE POLICY "album_likes_insert_self" ON public.album_likes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "album_likes_delete_self" ON public.album_likes;
CREATE POLICY "album_likes_delete_self" ON public.album_likes
  FOR DELETE TO authenticated USING (user_id = auth.uid());


-- ============ 四、相册级评论 ============

CREATE TABLE IF NOT EXISTS public.album_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name TEXT DEFAULT '',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_album_comments_album ON public.album_comments(album_id, created_at);

ALTER TABLE public.album_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "album_comments_select_auth" ON public.album_comments;
CREATE POLICY "album_comments_select_auth" ON public.album_comments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "album_comments_insert_self" ON public.album_comments;
CREATE POLICY "album_comments_insert_self" ON public.album_comments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "album_comments_delete_self_or_admin" ON public.album_comments;
CREATE POLICY "album_comments_delete_self_or_admin" ON public.album_comments
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
  );


-- ============ 五、realtime 发布（可选）============
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.album_photo_likes;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.album_photo_comments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.album_likes;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.album_comments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 完成 ✅
