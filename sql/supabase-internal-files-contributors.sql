-- 在 Supabase SQL Editor 执行一次；重复执行安全。
-- 仅覆盖当前条目的显示名单，不修改上传归属及父文件夹的自动上传者汇总。
-- 沿用 internal_files 的现有 UPDATE RLS（上传者本人或管理员）。
ALTER TABLE public.internal_files
  ADD COLUMN IF NOT EXISTS contributors_override TEXT
  CHECK (char_length(contributors_override) <= 500);
NOTIFY pgrst, 'reload schema';
