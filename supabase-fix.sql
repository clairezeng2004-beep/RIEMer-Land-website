-- ============================================
-- RIEMer Land — Supabase 增量修复脚本
-- ============================================
-- 修复问题：
--   1. profiles 表缺少 signature 列
--   2. member_profiles 表不存在
--
-- 在 Supabase 控制台 → SQL Editor 中运行此脚本
-- 所有语句都使用 IF NOT EXISTS / IF EXISTS 保护，可安全重复执行
-- ============================================

-- ========== 修复 1：为 profiles 表添加 signature 列 ==========
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'signature'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN signature TEXT NOT NULL DEFAULT '';
    RAISE NOTICE '✅ 已添加 profiles.signature 列';
  ELSE
    RAISE NOTICE 'ℹ️  profiles.signature 列已存在，跳过';
  END IF;
END $$;

-- ========== 修复 2：创建 member_profiles 表 ==========
CREATE TABLE IF NOT EXISTS public.member_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enrollment_year TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  further_education TEXT DEFAULT '',
  career TEXT DEFAULT '',
  willing_to_share TEXT DEFAULT '',
  want_to_learn TEXT DEFAULT '',
  hobbies TEXT DEFAULT '',
  hometown TEXT DEFAULT '',
  dream_city TEXT DEFAULT '',
  other TEXT DEFAULT '',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== 修复 3：启用 member_profiles 的 RLS ==========
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;

-- ========== 修复 4：member_profiles RLS 策略（先删再建，避免重复） ==========

-- 4a. 所有认证用户可查看成员信息
DROP POLICY IF EXISTS "所有认证用户可查看成员信息" ON public.member_profiles;
CREATE POLICY "所有认证用户可查看成员信息"
  ON public.member_profiles FOR SELECT
  TO authenticated
  USING (true);

-- 4b. 匿名用户可查看成员信息（"关于我们"页面需要）
DROP POLICY IF EXISTS "匿名用户可查看成员信息" ON public.member_profiles;
CREATE POLICY "匿名用户可查看成员信息"
  ON public.member_profiles FOR SELECT
  TO anon
  USING (true);

-- 4c. 用户只能编辑自己的成员信息
DROP POLICY IF EXISTS "用户可更新自己的成员信息" ON public.member_profiles;
CREATE POLICY "用户可更新自己的成员信息"
  ON public.member_profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4d. 管理员可以编辑所有成员信息
DROP POLICY IF EXISTS "管理员可更新所有成员信息" ON public.member_profiles;
CREATE POLICY "管理员可更新所有成员信息"
  ON public.member_profiles FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 4e. 用户可以插入自己的成员信息
DROP POLICY IF EXISTS "用户可插入自己的成员信息" ON public.member_profiles;
CREATE POLICY "用户可插入自己的成员信息"
  ON public.member_profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ========== 修复 5：授权触发器（自动创建 member_profiles 记录） ==========
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

DROP TRIGGER IF EXISTS on_user_authorized ON public.profiles;
CREATE TRIGGER on_user_authorized
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_member_profile();

-- ========== 修复 6：为已有的已授权用户补建 member_profiles 记录 ==========
INSERT INTO public.member_profiles (user_id, joined_at)
SELECT id, created_at FROM public.profiles WHERE authorized = true
ON CONFLICT (user_id) DO NOTHING;

-- ============================================
-- ✅ 修复完成！
-- 现在可以正常保存个人资料到云端了
-- ============================================

-- ========== 修复 7：创建 pre_authorized_emails 表（管理员预授权邮箱） ==========
CREATE TABLE IF NOT EXISTS public.pre_authorized_emails (
  email TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pre_authorized_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "所有认证用户可查看预授权列表" ON public.pre_authorized_emails;
CREATE POLICY "所有认证用户可查看预授权列表"
  ON public.pre_authorized_emails FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "管理员可添加预授权邮箱" ON public.pre_authorized_emails;
CREATE POLICY "管理员可添加预授权邮箱"
  ON public.pre_authorized_emails FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS "管理员可删除预授权邮箱" ON public.pre_authorized_emails;
CREATE POLICY "管理员可删除预授权邮箱"
  ON public.pre_authorized_emails FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS "匿名用户可查看预授权列表" ON public.pre_authorized_emails;
CREATE POLICY "匿名用户可查看预授权列表"
  ON public.pre_authorized_emails FOR SELECT
  TO anon
  USING (true);

-- ========== 修复 8：更新 handle_new_user 触发器，支持预授权自动授权 ==========
-- 注册时自动检查 pre_authorized_emails 表，若匹配则 authorized=true 并移除预授权记录
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  is_pre_authorized BOOLEAN := false;
BEGIN
  -- 检查该邮箱是否在预授权列表中（忽略大小写）
  SELECT EXISTS(
    SELECT 1 FROM public.pre_authorized_emails
    WHERE lower(email) = lower(NEW.email)
  ) INTO is_pre_authorized;

  INSERT INTO public.profiles (id, email, name, nickname, avatar, signature, role, authorized)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    '',
    NULL,
    '',
    'member',
    is_pre_authorized
  );

  -- 如果是预授权用户，从预授权列表中移除
  IF is_pre_authorized THEN
    DELETE FROM public.pre_authorized_emails WHERE lower(email) = lower(NEW.email);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ========== 修复 9：创建 notifications 表（跨设备通知同步） ==========
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'system' CHECK (type IN ('reminder', 'info', 'system')),
  date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  target_role TEXT DEFAULT NULL,  -- NULL=所有人, 'admin'=仅管理员
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "所有认证用户可查看通知" ON public.notifications;
CREATE POLICY "所有认证用户可查看通知"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "允许插入通知" ON public.notifications;
CREATE POLICY "允许插入通知"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "允许匿名插入通知" ON public.notifications;
CREATE POLICY "允许匿名插入通知"
  ON public.notifications FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "管理员可删除通知" ON public.notifications;
CREATE POLICY "管理员可删除通知"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- ========== 修复 10：创建 notification_reads 表（已读状态） ==========
CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "用户可查看自己的已读状态" ON public.notification_reads;
CREATE POLICY "用户可查看自己的已读状态"
  ON public.notification_reads FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "用户可标记自己的已读" ON public.notification_reads;
CREATE POLICY "用户可标记自己的已读"
  ON public.notification_reads FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ========== 修复 11：创建 articles 表（公众号文章归档） ==========
CREATE TABLE IF NOT EXISTS public.articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  raw_title TEXT DEFAULT '',
  author TEXT DEFAULT 'RIEMer Land',
  date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  category TEXT DEFAULT '经验分享',
  tags TEXT[] DEFAULT '{}',
  excerpt TEXT DEFAULT '',
  outline TEXT[] DEFAULT '{}',
  url TEXT DEFAULT '',
  content TEXT DEFAULT '',
  cover_image TEXT DEFAULT NULL,
  archived_by TEXT DEFAULT '未知',
  archived_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

-- 所有认证用户可查看文章
DROP POLICY IF EXISTS "所有认证用户可查看文章" ON public.articles;
CREATE POLICY "所有认证用户可查看文章"
  ON public.articles FOR SELECT
  TO authenticated
  USING (true);

-- 匿名用户可查看文章（公开页面展示）
DROP POLICY IF EXISTS "匿名用户可查看文章" ON public.articles;
CREATE POLICY "匿名用户可查看文章"
  ON public.articles FOR SELECT
  TO anon
  USING (true);

-- 认证用户可以添加文章
DROP POLICY IF EXISTS "认证用户可添加文章" ON public.articles;
CREATE POLICY "认证用户可添加文章"
  ON public.articles FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 管理员可以更新文章
DROP POLICY IF EXISTS "管理员可更新文章" ON public.articles;
CREATE POLICY "管理员可更新文章"
  ON public.articles FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    OR archived_by_id = auth.uid()
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    OR archived_by_id = auth.uid()
  );

-- 管理员可以删除文章
DROP POLICY IF EXISTS "管理员可删除文章" ON public.articles;
CREATE POLICY "管理员可删除文章"
  ON public.articles FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    OR archived_by_id = auth.uid()
  );

-- ========== 修复 12：为 articles 表添加 read_num 列（公众号阅读量） ==========
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'articles'
      AND column_name = 'read_num'
  ) THEN
    ALTER TABLE public.articles ADD COLUMN read_num INTEGER NOT NULL DEFAULT 0;
    RAISE NOTICE '✅ 已添加 articles.read_num 列';
  ELSE
    RAISE NOTICE 'ℹ️  articles.read_num 列已存在，跳过';
  END IF;
END $$;


-- ========== 修复 N：创建 site_settings 表（站点级全局配置，跨设备同步） ==========
-- 用途：保存管理员在"所见即所得"编辑模式下修改的内部空间配置
--       （侧边栏 Tab 名称、各页面标题、提示文案等）
CREATE TABLE IF NOT EXISTS public.site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- 所有已登录用户都可读（内部空间配置需要所有成员加载）
DROP POLICY IF EXISTS "site_settings read" ON public.site_settings;
CREATE POLICY "site_settings read"
  ON public.site_settings
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 只有管理员可写入 / 更新
DROP POLICY IF EXISTS "site_settings write admin" ON public.site_settings;
CREATE POLICY "site_settings write admin"
  ON public.site_settings
  FOR ALL
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- 启用 realtime 订阅（其它设备在管理员保存后自动刷新）
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings;
  RAISE NOTICE '✅ site_settings 已加入 realtime 发布';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'ℹ️  site_settings 已在 realtime 发布中，跳过';
END $$;


-- ========== 修复 N+1：把其它跨设备数据表也加入 realtime 发布 ==========
-- articles：公众号历史文章归档（A 设备归档后 B 设备实时出现）
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.articles;
  RAISE NOTICE '✅ articles 已加入 realtime 发布';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'ℹ️  articles 已在 realtime 发布中，跳过';
END $$;

-- documents：流程模板文件（编辑/新增/删除实时同步）
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
  RAISE NOTICE '✅ documents 已加入 realtime 发布';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'ℹ️  documents 已在 realtime 发布中，跳过';
END $$;

-- documents_deleted_defaults：默认模拟文档的删除记录（避免一端删了另一端又看到）
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.documents_deleted_defaults;
  RAISE NOTICE '✅ documents_deleted_defaults 已加入 realtime 发布';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'ℹ️  documents_deleted_defaults 已在 realtime 发布中，跳过';
END $$;

-- ============================================
-- 修复 N：创建 document_view_logs 表（访问记录明细）
-- ============================================
-- 用于承载小眼睛浏览数按钮点击后的"访客名单 + 访问时间"弹层。
-- document_views 表只记录总浏览数，无法展示谁看过；这里每条记录代表
-- 一次访问（同一用户每新会话重复计一次）。
--
-- 字段：
--   id         自增主键
--   document_id 文档 / 分享帖 id（与 documents.id 或 sharing id 对齐，沿用文本类型）
--   user_id    访问者 id（未登录时为 NULL）
--   user_name  访问者名称快照（避免成员改名后历史记录失真）
--   viewed_at  访问时间
CREATE TABLE IF NOT EXISTS public.document_view_logs (
  id BIGSERIAL PRIMARY KEY,
  document_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL DEFAULT '访客',
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 访问记录通常按 document_id + 时间倒序检索，加联合索引
CREATE INDEX IF NOT EXISTS idx_document_view_logs_doc_time
  ON public.document_view_logs (document_id, viewed_at DESC);

ALTER TABLE public.document_view_logs ENABLE ROW LEVEL SECURITY;

-- 认证用户可读取所有访问记录（用于"谁访问过"弹层）
DROP POLICY IF EXISTS "认证用户可查看访问记录" ON public.document_view_logs;
CREATE POLICY "认证用户可查看访问记录"
  ON public.document_view_logs FOR SELECT
  TO authenticated
  USING (true);

-- 认证用户可写入访问记录（每次浏览一条）
DROP POLICY IF EXISTS "认证用户可写入访问记录" ON public.document_view_logs;
CREATE POLICY "认证用户可写入访问记录"
  ON public.document_view_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 放入 realtime 发布（不是必须，但日后可以订阅新增访客通知）
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.document_view_logs;
  RAISE NOTICE '✅ document_view_logs 已加入 realtime 发布';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'ℹ️  document_view_logs 已在 realtime 发布中，跳过';
END $$;
