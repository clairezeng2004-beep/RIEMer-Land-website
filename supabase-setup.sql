-- ============================================
-- RIEMer Land — Supabase 数据库初始化脚本
-- ============================================
-- 在 Supabase 控制台的 SQL Editor 中运行此脚本
-- 它会创建：
--   1. profiles 表（存储用户角色和授权信息）
--   2. Row Level Security (RLS) 策略
--   3. 自动创建 profile 的触发器
-- ============================================

-- 1. 创建 profiles 表
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  avatar TEXT DEFAULT NULL,
  signature TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  authorized BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 启用 RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 3. RLS 策略

-- 所有已认证用户可以查看 profiles（用于用户列表）
CREATE POLICY "所有认证用户可查看 profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- 匿名用户可查看已授权成员的公开信息（"关于我们"页面需要）
CREATE POLICY "匿名用户可查看已授权成员公开信息"
  ON profiles FOR SELECT
  TO anon
  USING (authorized = true);

-- 用户可以更新自己的基本信息（但不能改角色和授权状态）
CREATE POLICY "用户可更新自己的基本信息"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
    AND authorized = (SELECT authorized FROM profiles WHERE id = auth.uid())
  );

-- owner 和 admin 可以更新其他用户的角色和授权状态
CREATE POLICY "管理员可管理用户"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 允许插入新的 profile（注册时使用）
CREATE POLICY "允许插入 profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- 4. 自动创建 profile 的触发器函数
-- 注意：会自动检查 pre_authorized_emails 表，若邮箱已被预授权则直接设 authorized=true
--       并自动从预授权列表中移除该邮箱
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

-- 5. 在用户注册时自动创建 profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 6. 创建 member_profiles 表（成员信息表格）
-- ============================================
CREATE TABLE IF NOT EXISTS member_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
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

-- 7. 启用 member_profiles 的 RLS
ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;

-- 8. member_profiles RLS 策略

-- 所有已认证用户可以查看所有成员信息
CREATE POLICY "所有认证用户可查看成员信息"
  ON member_profiles FOR SELECT
  TO authenticated
  USING (true);

-- 匿名用户可查看成员信息（"关于我们"页面需要）
CREATE POLICY "匿名用户可查看成员信息"
  ON member_profiles FOR SELECT
  TO anon
  USING (true);

-- 用户只能编辑自己的成员信息
CREATE POLICY "用户可更新自己的成员信息"
  ON member_profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 管理员可以编辑所有成员信息
CREATE POLICY "管理员可更新所有成员信息"
  ON member_profiles FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 用户可以插入自己的成员信息
CREATE POLICY "用户可插入自己的成员信息"
  ON member_profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 9. 新用户授权后自动创建 member_profiles 记录的触发器
CREATE OR REPLACE FUNCTION public.handle_new_member_profile()
RETURNS TRIGGER AS $$
BEGIN
  -- 当用户被授权时，自动创建 member_profiles 记录
  IF NEW.authorized = true AND (OLD.authorized IS NULL OR OLD.authorized = false) THEN
    INSERT INTO public.member_profiles (user_id, joined_at)
    VALUES (NEW.id, COALESCE(NEW.created_at, now()))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_authorized ON profiles;
CREATE TRIGGER on_user_authorized
  AFTER UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_member_profile();

-- 10. 为已有的已授权用户补建 member_profiles 记录
INSERT INTO member_profiles (user_id, joined_at)
SELECT id, created_at FROM profiles WHERE authorized = true
ON CONFLICT (user_id) DO NOTHING;

-- ============================================
-- 11. 创建 notifications 表（跨设备通知同步）
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'system' CHECK (type IN ('reminder', 'info', 'system')),
  date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  target_role TEXT DEFAULT NULL,  -- NULL=所有人, 'admin'=仅管理员
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. 启用 notifications 的 RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 所有已认证用户可以查看通知
CREATE POLICY "所有认证用户可查看通知"
  ON notifications FOR SELECT
  TO authenticated
  USING (true);

-- 允许插入通知（注册触发器和应用代码都需要）
CREATE POLICY "允许插入通知"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 匿名用户也可以插入通知（注册时用户尚未认证）
CREATE POLICY "允许匿名插入通知"
  ON notifications FOR INSERT
  TO anon
  WITH CHECK (true);

-- 管理员可以删除通知
CREATE POLICY "管理员可删除通知"
  ON notifications FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 13. 创建 notification_reads 表（记录每个用户的已读状态）
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可查看自己的已读状态"
  ON notification_reads FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "用户可标记自己的已读"
  ON notification_reads FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 14. 新用户注册后的授权通知由应用代码（AuthContext.jsx register 函数）负责插入，
--     无需数据库触发器，避免重复通知。

-- ============================================
-- 15. 创建 pre_authorized_emails 表（管理员预授权邮箱）
-- ============================================
-- 管理员可以提前输入邮箱授权，用户注册时自动匹配并获得访问权限
CREATE TABLE IF NOT EXISTS pre_authorized_emails (
  email TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 16. 启用 pre_authorized_emails 的 RLS
ALTER TABLE pre_authorized_emails ENABLE ROW LEVEL SECURITY;

-- 所有已认证用户可以查看预授权列表
CREATE POLICY "所有认证用户可查看预授权列表"
  ON pre_authorized_emails FOR SELECT
  TO authenticated
  USING (true);

-- 管理员可以添加预授权邮箱
CREATE POLICY "管理员可添加预授权邮箱"
  ON pre_authorized_emails FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 管理员可以删除预授权邮箱
CREATE POLICY "管理员可删除预授权邮箱"
  ON pre_authorized_emails FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 匿名用户可以查看预授权列表（注册时需要检查）
CREATE POLICY "匿名用户可查看预授权列表"
  ON pre_authorized_emails FOR SELECT
  TO anon
  USING (true);

-- ============================================
-- 初始设置完成后，手动操作：
-- 1. 注册你的账号（通过网站或 Supabase Dashboard）
-- 2. 在 Supabase SQL Editor 中运行以下命令，
--    将你的账号设为管理员：
--
--    UPDATE profiles
--    SET role = 'admin', authorized = true
--    WHERE email = '你的邮箱@example.com';
-- ============================================
