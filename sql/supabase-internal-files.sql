-- ============================================================
-- RIEMer Land - 「内部资料」文件资源管理器 一键升级 SQL
-- 执行位置: Supabase Dashboard -> SQL Editor -> New Query -> 全选粘贴 -> Run
-- 特点:
--   * 完全幂等：重复执行不会报错（IF NOT EXISTS / DROP POLICY IF EXISTS / DO $$ 块）
--   * 独立自包含：只依赖 public.profiles(id, role) 已存在
--   * 数据模型：单表自引用树 —— 文件夹与文件都是一行，parent_id 指向所在文件夹，
--     parent_id 为 NULL 即根目录；删除文件夹时子孙行随 FK ON DELETE CASCADE 一并删除
--     （Storage 里的实际文件由前端 internalFilesService 先行清理）
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PART A: 数据表 internal_files（文件夹 + 文件 混合树）
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.internal_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 所在文件夹；NULL = 根目录。删除父文件夹时级联删除子孙。
  parent_id UUID REFERENCES public.internal_files(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  is_folder BOOLEAN NOT NULL DEFAULT false,
  -- 以下字段仅文件行有值
  storage_path TEXT,          -- Storage 中的对象路径
  url TEXT,                    -- 公开访问 URL
  mime_type TEXT DEFAULT '',
  size_bytes BIGINT DEFAULT 0,
  -- 归属信息
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 常用索引：按父目录列子项 / 按创建者过滤
CREATE INDEX IF NOT EXISTS idx_internal_files_parent ON public.internal_files(parent_id);
CREATE INDEX IF NOT EXISTS idx_internal_files_parent_folder_name
  ON public.internal_files(parent_id, is_folder DESC, name);
CREATE INDEX IF NOT EXISTS idx_internal_files_creator ON public.internal_files(created_by_id);


-- ════════════════════════════════════════════════════════════
-- PART B: RLS 行级安全
--   * 所有已登录成员可查看全部资料（内部共享盘）
--   * 所有已登录成员可新建文件夹 / 上传文件
--   * 仅「创建者本人」或「管理员/所有者」可重命名 / 删除
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.internal_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal_files_select_auth" ON public.internal_files;
CREATE POLICY "internal_files_select_auth" ON public.internal_files
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "internal_files_insert_auth" ON public.internal_files;
CREATE POLICY "internal_files_insert_auth" ON public.internal_files
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "internal_files_update_owner_or_admin" ON public.internal_files;
CREATE POLICY "internal_files_update_owner_or_admin" ON public.internal_files
  FOR UPDATE TO authenticated
  USING (
    created_by_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
  );

DROP POLICY IF EXISTS "internal_files_delete_owner_or_admin" ON public.internal_files;
CREATE POLICY "internal_files_delete_owner_or_admin" ON public.internal_files
  FOR DELETE TO authenticated
  USING (
    created_by_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
  );

-- realtime 发布（可选，用于多端实时刷新）
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_files;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- PART C: Storage bucket internal-files
--   与站内相册 / 文章封面一致，使用「公开读」bucket；
--   对象路径带随机串不可枚举，下载直接走 public URL，无需签名。
-- ════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES ('internal-files', 'internal-files', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "internal_files_public_read" ON storage.objects;
CREATE POLICY "internal_files_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'internal-files');

DROP POLICY IF EXISTS "internal_files_auth_upload" ON storage.objects;
CREATE POLICY "internal_files_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'internal-files');

DROP POLICY IF EXISTS "internal_files_owner_update" ON storage.objects;
CREATE POLICY "internal_files_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'internal-files'
    AND (
      owner = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
    )
  );

DROP POLICY IF EXISTS "internal_files_owner_delete" ON storage.objects;
CREATE POLICY "internal_files_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'internal-files'
    AND (
      owner = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
    )
  );


-- ════════════════════════════════════════════════════════════
-- 完成 ✅
--   如果你看到 "Success. No rows returned" 就全部成功
-- ════════════════════════════════════════════════════════════
