-- ============================================
-- 工作项关联（WorkItem link）字段
-- ============================================
-- 背景：
--   事项追踪（tasks）、公众号文章归档（articles，前端叫 userArticles）、
--   活动发布（events，存在 site_settings.events 的 JSON 里）三者在业务上是
--   同一件"工作"的不同侧面——同一件事通常会有一条 task（筹备），最终产出
--   一条 article（推文归档）或一场 event（活动落地）。
--
--   本脚本为 tasks / articles 两张独立表新增 work_item_id 字段（可选），
--   相同 work_item_id = 同一件工作。events 因为存在 site_settings.events 的
--   JSON blob 里，不需要改 schema —— 前端在写入 event 对象时把 workItemId
--   作为普通字段写进 JSON 即可。
--
--   命名约定：
--     - 数据库列名使用 snake_case（work_item_id / work_item_kind）；
--     - 前端对象字段使用 camelCase（workItemId / workItemKind），
--       在 Tasks.jsx 的 rowToTask / taskToRow 以及 articleDbService.js 的
--       dbToFrontend / frontendToDb 两处做转换。
--
--   work_item_kind 仅对 tasks 有意义：
--     - 'article' 表示"这个事项最终会产出一篇公众号文章"
--     - 'event'   表示"这个事项最终会落地一场活动"
--     - NULL      表示纯内部事项，不参与闭环
-- ============================================

-- 1) tasks 表：workItemId + workItemKind
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS work_item_id TEXT DEFAULT NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS work_item_kind TEXT DEFAULT NULL
  CHECK (work_item_kind IS NULL OR work_item_kind IN ('article', 'event'));

CREATE INDEX IF NOT EXISTS idx_tasks_work_item_id ON tasks (work_item_id);

-- 2) articles 表：workItemId
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS work_item_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_work_item_id ON articles (work_item_id);

-- 备注：events 的 workItemId 不写到数据库列里——events 作为 JSON 存在
-- site_settings.value 的数组元素中，前端在创建/更新时直接以普通字段形式
-- 写入 event 对象即可。无需 schema 迁移。
