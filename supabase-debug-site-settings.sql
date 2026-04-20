-- ============================================================
-- RIEMer Land —— site_settings 跨设备同步 一键诊断 + 修复脚本
-- ============================================================
-- 使用场景：
--   某位管理员在 A 设备改了「内容管理 → 筛选项」，但 B 设备（或其他成员）
--   看不到新值。这个脚本会：
--     1) 诊断 site_settings 表是否存在、结构是否正确
--     2) 诊断 RLS 策略（SELECT / 写入）是否配齐
--     3) 诊断 realtime publication 是否包含 site_settings
--     4) 展示当前 filter_options 条目的 value 片段，判断"是本地没推上去"
--        还是"推上去了但另一台设备没拉"
--     5) 如果 1~3 缺失，自动用 IF NOT EXISTS / DROP POLICY IF EXISTS
--        的幂等方式补全，跑完就修好（不会误覆盖已有数据）
--
-- 使用方式：
--   打开 Supabase Dashboard → SQL Editor → 粘贴本脚本整体 Run。
--   结果会分段输出（NOTICE 里说了每一步是 OK 还是 FIXED）。
--
-- 跑完之后请立刻做：
--   A 设备：退出内容管理 → 重新进 → 改一项筛选值 → 保存，看顶部 toast
--           应当是绿色的"内容已保存并同步到云端…"
--   B 设备：不用手动刷新（加进 realtime 后应当秒级拉到），等 2-3s 见效
-- ============================================================


-- ===== STEP 1. 确保 site_settings 表存在 =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_settings'
  ) THEN
    CREATE TABLE public.site_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
    );
    RAISE NOTICE '🛠  [FIXED] site_settings 表已创建';
  ELSE
    RAISE NOTICE '✅ [OK] site_settings 表已存在';
  END IF;
END $$;


-- ===== STEP 2. 确保 RLS 开启 + 策略齐全 =====
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
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

DO $$
BEGIN
  RAISE NOTICE '✅ [OK] site_settings RLS 策略已重建：登录可读，admin 可写';
END $$;


-- ===== STEP 3. 确保 realtime publication 包含本表 =====
DO $$
BEGIN
  -- 如果 publication 里已有 site_settings，这一句会抛 duplicate_object 被吃掉
  ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings;
  RAISE NOTICE '🛠  [FIXED] site_settings 已加入 realtime 发布';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE '✅ [OK] site_settings 已在 realtime 发布中';
  WHEN undefined_object THEN
    -- 自建库没有 supabase_realtime publication 的情况（非云实例），给出明确提示
    RAISE NOTICE '⚠  当前数据库不存在 supabase_realtime publication；realtime 无法生效（仅刷新后可见）';
END $$;


-- ===== STEP 4. 诊断：当前的 filter_options 条目长啥样？ =====
-- 如果返回 0 行 → 说明 A 设备保存时从未成功 insert 过，问题在写入路径（看 STEP 5）
-- 如果有 1 行且 updated_at 很新 → 说明云端存的是最新的，问题在 B 设备的读取/订阅
DO $$
DECLARE
  v_count INT;
  v_updated TIMESTAMPTZ;
  v_preview TEXT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.site_settings WHERE key = 'filter_options';

  IF v_count = 0 THEN
    RAISE NOTICE '❌ site_settings 里不存在 key=filter_options 的记录';
    RAISE NOTICE '   → 说明 A 设备那次"保存"从未真正写进云（多半是 RLS 拒绝或未登录）';
    RAISE NOTICE '   → 现在 RLS 已修好，请重新登录 admin → 内容管理 → 改一项 → 保存';
  ELSE
    SELECT updated_at, LEFT(value::text, 200)
      INTO v_updated, v_preview
      FROM public.site_settings WHERE key = 'filter_options';
    RAISE NOTICE '✅ site_settings.filter_options 存在，updated_at=%', v_updated;
    RAISE NOTICE '   value 预览（前 200 字符）：%', v_preview;
    RAISE NOTICE '   → 如果该值就是 A 设备最新修改，那问题在 B 设备读取（看 STEP 5）';
  END IF;
END $$;


-- ===== STEP 5. 诊断：当前登录账号是不是 admin？ =====
-- 只有 admin 才能写 site_settings。如果当前会话 role ≠ admin，页面保存就会
-- 返回 "new row violates row-level security policy"，前端只 console.warn，
-- 对用户是无感的 —— 这次改动已经把这种失败明文弹到 toast 里了。
DO $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE NOTICE 'ℹ  当前在 SQL Editor 内 auth.uid() 为 NULL（这是正常的，SQL Editor 以 service_role 运行）';
    RAISE NOTICE '   若要验证"真实用户是否为 admin"，请在浏览器控制台执行：';
    RAISE NOTICE '     (await window.supabase.auth.getUser()).data.user.id';
    RAISE NOTICE '   再到这里用：';
    RAISE NOTICE '     SELECT id, email, role FROM public.profiles WHERE id = ''<上面的 uid>'';';
  ELSE
    SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
    IF v_role = 'admin' THEN
      RAISE NOTICE '✅ 当前会话 uid=% 的 role=admin，可写 site_settings', v_uid;
    ELSE
      RAISE NOTICE '❌ 当前会话 uid=% 的 role=%（不是 admin）→ 会被写策略拒绝', v_uid, v_role;
      RAISE NOTICE '   请让有数据库 admin 权限的人把该账号 role 改为 admin';
    END IF;
  END IF;
END $$;


-- ===== STEP 6. 一键检查所有 site_settings 条目的更新时间 =====
-- 让管理员一眼看出"筛选项最后一次成功写云"是什么时候
SELECT
  key,
  updated_at,
  LENGTH(value::text) AS value_bytes,
  updated_by
FROM public.site_settings
ORDER BY updated_at DESC;


-- ============================================================
-- 跑完之后的判断指引
-- ============================================================
-- 情况 A（最常见）：STEP 4 输出"不存在 key=filter_options"
--   → 写入路径从来没成功过。现在表和 RLS 都已修好，
--     去 A 设备（管理员）重试保存，前端顶部 toast 会明确给出成功/失败。
--
-- 情况 B：STEP 4 有记录且 updated_at 很新，但 B 设备仍看不到
--   → realtime 问题。STEP 3 已修复 publication，B 设备刷新一次即可。
--     今后 A 改完 B 应当 2-3s 内自动更新。
--
-- 情况 C：STEP 5 显示 role ≠ admin
--   → 当前账号不是 admin，自然写不了。请换 admin 账号再保存。
-- ============================================================
