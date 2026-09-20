-- ============================================
-- 板块访问权限：成员内部分享 / 内部资料
-- --------------------------------------------
-- 目标：
--   • 现有成员：保留访问权限（本脚本执行时一次性授予）
--   • 以后新注册的成员：默认没有权限，需管理员在「用户管理」里手动开启
--   • 管理员：始终可见，不受这两列影响（前端逻辑保证）
--
-- 说明：
--   这是「软权限」——只在前端隐藏入口 + 拦截路由，暂不做 RLS。
--   底层表 member_sharing / internal_files 仍是公开读，懂技术的人
--   直接调 Supabase 仍能拿到数据。若日后需要真正的数据级保密，
--   再在这两张表和对应 storage bucket 上加 RLS（见文件末尾注释）。
-- ============================================

-- 1. 加两列（先不给默认值，让现有行落到 NULL，便于下一步「祖父条款」区分）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_view_member_sharing BOOLEAN;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_view_internal_files BOOLEAN;

-- 2. 祖父条款：把执行本脚本时「已存在」的成员全部设为可见
UPDATE profiles SET can_view_member_sharing = true WHERE can_view_member_sharing IS NULL;
UPDATE profiles SET can_view_internal_files = true WHERE can_view_internal_files IS NULL;

-- 3. 新注册用户默认无权限（handle_new_user 触发器插入 profile 时不带这两列 → 走默认值 false）
ALTER TABLE profiles ALTER COLUMN can_view_member_sharing SET DEFAULT false;
ALTER TABLE profiles ALTER COLUMN can_view_internal_files SET DEFAULT false;

-- 4. 收紧为 NOT NULL（此时现有行已是 true，新行走默认 false，不会有 NULL）
ALTER TABLE profiles ALTER COLUMN can_view_member_sharing SET NOT NULL;
ALTER TABLE profiles ALTER COLUMN can_view_internal_files SET NOT NULL;

-- ============================================
-- 可选加固（当前未启用）：
--   现有的「用户可更新自己的基本信息」策略只锁了 role / authorized，
--   并未锁这两列，理论上用户可自行改写自己的 can_view_*。若要防止
--   成员自我授权，把该策略的 WITH CHECK 追加两行约束即可：
--
--   DROP POLICY IF EXISTS "用户可更新自己的基本信息" ON profiles;
--   CREATE POLICY "用户可更新自己的基本信息"
--     ON profiles FOR UPDATE
--     TO authenticated
--     USING (id = auth.uid())
--     WITH CHECK (
--       id = auth.uid()
--       AND role = (SELECT role FROM profiles WHERE id = auth.uid())
--       AND authorized = (SELECT authorized FROM profiles WHERE id = auth.uid())
--       AND can_view_member_sharing = (SELECT can_view_member_sharing FROM profiles WHERE id = auth.uid())
--       AND can_view_internal_files = (SELECT can_view_internal_files FROM profiles WHERE id = auth.uid())
--     );
--   （管理员走「管理员可管理用户」策略，不受影响）
-- ============================================
