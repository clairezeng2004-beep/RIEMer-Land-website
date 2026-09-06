-- ================================================================
-- 安全加固：为 SECURITY DEFINER 触发器函数锁定 search_path
-- ================================================================
-- 背景：
--   handle_new_user / handle_new_member_profile 以 SECURITY DEFINER（创建者高权限）
--   运行，却没有固定 search_path，命中 Supabase Linter 的
--   `function_search_path_mutable` 告警，属于 SECURITY DEFINER 函数的提权面。
--
-- 本脚本：
--   - 幂等、可重复执行；只重定义函数体，追加 `SET search_path = public, pg_temp`。
--   - 与较新的 RPC（supabase-article-batch-mutations.sql）保持同一写法。
--   - 不删除/迁移任何数据，不改动触发器绑定关系。
--   - 函数内部的表引用本就 schema 限定（public.xxx），加固后行为不变。
-- 部署：在 supabase-setup.sql / supabase-fix.sql / supabase-members-and-albums.sql
--   之后执行即可（覆盖为最终版本）。

-- 注册时自动创建 profile，并处理预授权邮箱。
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- 用户被授权（profiles.authorized 由 false→true）时自动补建 member_profiles 行。
CREATE OR REPLACE FUNCTION public.handle_new_member_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.authorized = true AND (OLD.authorized IS NULL OR OLD.authorized = false) THEN
    INSERT INTO public.member_profiles (user_id, joined_at)
    VALUES (NEW.id, COALESCE(NEW.created_at, now()))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
