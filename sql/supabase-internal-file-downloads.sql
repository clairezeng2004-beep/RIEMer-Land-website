-- ============================================================
-- RIEMer Land -「内部资料 · 下载历史」记录表 一键升级 SQL
-- 执行位置: Supabase Dashboard -> SQL Editor -> New Query -> 全选粘贴 -> Run
-- 特点:
--   * 完全幂等：重复执行不会报错（IF NOT EXISTS / DROP POLICY IF EXISTS / DO $$ 块）
--   * 依赖 public.internal_files 与 public.profiles 已存在
-- 记录时机（前端 internalFilesService.logFileDownload）：
--   成员在站内预览弹窗里点「下载」或「打印」，或点列表行的「下载」图标时写入一行。
--   仅「点开文件预览」本身不记录。
-- 可见性：
--   仅管理员 / 所有者可以读取整张历史表；每位成员只能写入自己的记录。
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PART A: 数据表 internal_file_downloads（下载 / 打印 流水）
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.internal_file_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 关联的文件；文件被删除后置空，历史仍保留（用 file_name 快照）
  file_id UUID REFERENCES public.internal_files(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL DEFAULT '',
  -- 动作类型：download（下载/保存）或 print（打印）
  action TEXT NOT NULL DEFAULT 'download'
    CHECK (action IN ('download', 'print')),
  -- 操作者（成员被删除后置空，历史仍保留用 user_name 快照）
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 按时间倒序翻页的主索引
CREATE INDEX IF NOT EXISTS idx_internal_file_downloads_created_at
  ON public.internal_file_downloads(created_at DESC);
-- 按文件 / 成员过滤
CREATE INDEX IF NOT EXISTS idx_internal_file_downloads_file
  ON public.internal_file_downloads(file_id);
CREATE INDEX IF NOT EXISTS idx_internal_file_downloads_user
  ON public.internal_file_downloads(user_id);


-- ════════════════════════════════════════════════════════════
-- PART B: RLS 行级安全
--   * 每位已登录成员只能写入「自己」的下载记录（user_id = auth.uid()）
--   * 仅管理员 / 所有者可读取整张历史表（普通成员看不到）
--   * 仅管理员 / 所有者可删除记录（用于清理）
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.internal_file_downloads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ifd_insert_self" ON public.internal_file_downloads;
CREATE POLICY "ifd_insert_self" ON public.internal_file_downloads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ifd_select_admin" ON public.internal_file_downloads;
CREATE POLICY "ifd_select_admin" ON public.internal_file_downloads
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'owner')
  );

DROP POLICY IF EXISTS "ifd_delete_admin" ON public.internal_file_downloads;
CREATE POLICY "ifd_delete_admin" ON public.internal_file_downloads
  FOR DELETE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'owner')
  );


-- ════════════════════════════════════════════════════════════
-- 完成 ✅
--   如果你看到 "Success. No rows returned" 就全部成功
-- ════════════════════════════════════════════════════════════
