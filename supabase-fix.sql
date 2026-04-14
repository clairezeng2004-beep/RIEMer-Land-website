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
