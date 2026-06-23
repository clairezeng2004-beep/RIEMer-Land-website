-- ============================================
-- tasks 表新增：亮点总结 / 经验复盘
-- ============================================
-- 背景：事项追踪表格原先最后一列是"备注"——实际是状态切换时的临时 reason 输入。
-- 用户希望把它改名为"亮点总结"、并新增一列"经验复盘"，两者都作为随任务持久化的字段。
-- 前端代码：src/pages/internal/Tasks.jsx（rowToTask / taskToRow / updateTaskField）
--
-- 本脚本幂等，可多次执行。已部署的项目只需把这一段在 Supabase SQL Editor 里跑一次即可。
-- 新部署项目请直接跑 supabase-setup.sql（里面也包含这两列）。
-- ============================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS highlights TEXT NOT NULL DEFAULT '';

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS reflections TEXT NOT NULL DEFAULT '';

-- 可选：给现有行做一次显式 UPDATE，把 NULL 转成空串（DEFAULT 已保证新行，但极老数据若有 NULL 这里兜底）
UPDATE tasks SET highlights = '' WHERE highlights IS NULL;
UPDATE tasks SET reflections = '' WHERE reflections IS NULL;
