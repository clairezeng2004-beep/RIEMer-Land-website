-- ============================================================
-- RIEMer Land —— site_settings 跨设备同步 一键诊断 + 修复脚本
-- ============================================================
-- 使用场景：
--   某位管理员在 A 设备改了「内容管理 → 筛选项」，但 B 设备（或其他成员）
--   看不到新值。这个脚本会：
--     1) 诊断 + 修复 site_settings 表结构
--     2) 诊断 + 修复 RLS 策略（SELECT / 写入）
--     3) 诊断 + 修复 realtime publication
--     4) 展示当前 filter_options 的写入状态（判断是"没推上去"还是"没拉下来"）
--     5) 展示 site_settings 的所有条目更新时间
--
-- 使用方式：
--   打开 Supabase Dashboard → SQL Editor → 粘贴本脚本整体 Run。
--   也可在 DBeaver / TablePlus / DataGrip 等桌面客户端整体执行。
--   诊断输出部分仍是纯 DDL + SELECT；仅 STEP 3 用到一个不含 DECLARE
--   的极简 DO 块做"表是否已在 publication 里"的条件判断（详见 STEP 3）。
--
-- 历史：
--   v1 用 DO $$ ... DECLARE v_count INT ... $$ 做诊断输出，
--   在 Supabase SQL Editor 里 OK，但在第三方客户端会把 DECLARE 块
--   里的 v_count 当成"表名"解析，报 42P01 relation "v_count" does not exist。
--   v2 改为纯 SQL 输出：每一步返回一行/多行结果，直观可见。
--   v3（当前）修复 STEP 3：直接 ALTER PUBLICATION ADD TABLE 在表已加入
--   时会抛 42710 "relation ... is already member of publication"，
--   Supabase SQL Editor 把这个错误当硬错误中断整个脚本。改成：先查
--   pg_publication_rel，未加入才 ADD。仍是极简 DO 块（无 DECLARE），
--   不触碰 v1 的坑。
-- ============================================================


-- ============================================================
-- STEP 1. 确保 site_settings 表存在（幂等）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.site_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 验证：应当返回一行，table_name = 'site_settings'
SELECT
  '[STEP 1] site_settings 表'                               AS step,
  table_name,
  'OK: 表已存在（已通过 CREATE IF NOT EXISTS 确保）'         AS status
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'site_settings';


-- ============================================================
-- STEP 2. 确保 RLS 开启 + 策略齐全（幂等）
-- ============================================================
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- 2.1 读策略：所有已登录用户
DROP POLICY IF EXISTS "site_settings read" ON public.site_settings;
CREATE POLICY "site_settings read"
  ON public.site_settings
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 2.2 写策略：仅 admin
DROP POLICY IF EXISTS "site_settings write admin" ON public.site_settings;
CREATE POLICY "site_settings write admin"
  ON public.site_settings
  FOR ALL
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- 验证：应当输出两条策略（read + write admin）
SELECT
  '[STEP 2] site_settings RLS 策略' AS step,
  policyname,
  cmd,
  CASE
    WHEN policyname IN ('site_settings read', 'site_settings write admin')
      THEN 'OK'
    ELSE '其它策略（保留）'
  END AS status
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'site_settings'
ORDER BY policyname;


-- ============================================================
-- STEP 3. 确保 realtime publication 包含 site_settings
-- ============================================================
-- 直接 ALTER PUBLICATION ADD TABLE 在表已加入时会抛
--   ERROR 42710: relation "site_settings" is already member of publication
-- Supabase SQL Editor 会把这个错误当硬错误中断整个脚本（后续 STEP 不执行）。
-- 为了幂等，这里先查 pg_publication_rel，仅在未加入时才 ADD。
--
-- 注意：这个 DO 块不声明任何变量（没有 DECLARE），所以不会触发 v1 版本
-- 在第三方客户端上"把 DECLARE 的变量名当成表名解析"的坑。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication p
    JOIN pg_publication_rel pr ON pr.prpubid = p.oid
    JOIN pg_class c            ON c.oid      = pr.prrelid
    JOIN pg_namespace n        ON n.oid      = c.relnamespace
    WHERE p.pubname = 'supabase_realtime'
      AND n.nspname = 'public'
      AND c.relname = 'site_settings'
  ) THEN
    -- 只有当 publication 存在时才 ADD；不存在则忽略（非 Supabase 云环境）
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings;
    END IF;
  END IF;
END
$$;

-- 验证：应当输出一行，说明 site_settings 在 supabase_realtime 里
SELECT
  '[STEP 3] realtime publication' AS step,
  p.pubname,
  c.relname AS table_name,
  'OK: 已在 publication 内' AS status
FROM pg_publication p
JOIN pg_publication_rel pr ON pr.prpubid = p.oid
JOIN pg_class c ON c.oid = pr.prrelid
WHERE p.pubname = 'supabase_realtime'
  AND c.relname = 'site_settings';


-- ============================================================
-- STEP 4. 诊断：当前 filter_options 条目状态
-- ============================================================
-- 返回 0 行 → A 设备保存时从未成功写入（RLS 拒绝 / 未登录 / 其它）
-- 返回 1 行且 updated_at 很新 → 云端存的是最新的，问题在 B 设备读取/订阅
SELECT
  '[STEP 4] filter_options 记录' AS step,
  key,
  updated_at,
  updated_by,
  LENGTH(value::text) AS value_bytes,
  LEFT(value::text, 200) AS value_preview
FROM public.site_settings
WHERE key = 'filter_options';

-- 如果上一条返回 0 行，执行这个可以显式看到"没记录"
SELECT
  '[STEP 4] filter_options 是否存在' AS step,
  EXISTS (
    SELECT 1 FROM public.site_settings WHERE key = 'filter_options'
  ) AS filter_options_exists;


-- ============================================================
-- STEP 5. 诊断：当前 SQL 会话的身份
-- ============================================================
-- SQL Editor / 桌面客户端通常以 service_role 运行，auth.uid() 是 NULL，
-- 不等于"前端用户不是 admin"；要验证前端那个账号，按下方 NOTE。
SELECT
  '[STEP 5] 当前会话身份' AS step,
  auth.uid() AS auth_uid,
  CASE
    WHEN auth.uid() IS NULL
      THEN 'SQL Editor / 桌面客户端通常以 service_role 跑，auth.uid() 为 NULL 是正常的'
    ELSE (SELECT 'role=' || COALESCE(role::text, 'NULL')
            FROM public.profiles WHERE id = auth.uid())
  END AS note;

-- NOTE：要验证"前端那个登录账号是不是 admin"，在浏览器控制台取到 uid：
--   (await window.supabase.auth.getUser()).data.user.id
-- 然后在这里执行（替换 <uid>）：
--   SELECT id, email, role FROM public.profiles WHERE id = '<uid>';


-- ============================================================
-- STEP 6. 一键检查所有 site_settings 条目的更新时间
-- ============================================================
SELECT
  '[STEP 6] 所有 site_settings 条目' AS step,
  key,
  updated_at,
  LENGTH(value::text) AS value_bytes,
  updated_by
FROM public.site_settings
ORDER BY updated_at DESC;


-- ============================================================
-- 跑完之后的判断指引
-- ============================================================
-- 情况 A（最常见）：STEP 4 两条都显示"不存在 key=filter_options"
--   → 写入路径从来没成功过。现在表和 RLS 都已修好，
--     去 A 设备（管理员）重试保存，前端顶部 toast 会明确给出成功/失败。
--
-- 情况 B：STEP 4 有记录且 updated_at 很新，但 B 设备仍看不到
--   → realtime 问题。STEP 3 已修复 publication，B 设备刷新一次即可。
--     今后 A 改完 B 应当 2-3s 内自动更新。
--
-- 情况 C：STEP 5 里 auth_uid 不为 NULL 且 role ≠ admin
--   → 当前会话账号不是 admin，自然写不了。换 admin 账号再保存。
--     （如果 auth_uid 为 NULL，请按 NOTE 用浏览器控制台查前端账号）
-- ============================================================
