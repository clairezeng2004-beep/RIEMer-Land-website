-- ============================================
-- RIEMer Land — 文档详情页性能优化脚本
-- ============================================
-- 背景：
--   用户反馈打开一篇文档时「访客加载 / 评论加载 / 编辑历史加载」都很慢。
--   前端侧已经做了以下优化：
--     1) 用户目录 (profiles) 调用加模块级 30s 缓存 + 并发去重；
--     2) 浏览计数写入 (incrementView) 和访问日志 (recordViewLog) 延迟 1.5s；
--     3) 编辑历史拉取 + realtime 订阅延迟 400ms；
--     4) fetchViewsFromCloud 把 select(*) 收窄到只要的两列；
--     5) incrementView 优先走本脚本里定义的 RPC，一次 RT 原子 +1。
--
--   还有一部分热点 query 的耗时和「是否命中索引」有关，本脚本集中处理这部分。
--
-- 在 Supabase 控制台 → SQL Editor 中整段执行。
-- 所有语句都使用 IF NOT EXISTS / CREATE OR REPLACE，可安全重复执行。
-- ============================================

-- ========== 1) document_edit_logs 的复合索引 ==========
-- 热点查询：
--   SELECT editor_id,editor_name,edited_at,changes
--   FROM document_edit_logs
--   WHERE document_id = $1
--   ORDER BY edited_at DESC
--   LIMIT 200;
-- 没有 (document_id, edited_at DESC) 复合索引时，PostgreSQL 需要
-- 全表扫 + 内存排序，随表体增长线性变慢。加了之后走索引顺序扫描，O(log N)。
CREATE INDEX IF NOT EXISTS idx_document_edit_logs_doc_edited_at
  ON public.document_edit_logs (document_id, edited_at DESC);

-- ========== 2) document_view_logs 的复合索引 ==========
-- 热点查询（仅在用户点开小眼睛弹层时触发，但一旦触发也要快）：
--   SELECT user_id,user_name,viewed_at
--   FROM document_view_logs
--   WHERE document_id = $1
--   ORDER BY viewed_at DESC
--   LIMIT 500;
CREATE INDEX IF NOT EXISTS idx_document_view_logs_doc_viewed_at
  ON public.document_view_logs (document_id, viewed_at DESC);

-- ========== 3) annotations 的复合索引 ==========
-- 热点查询（评论加载）：
--   SELECT * FROM annotations
--   WHERE target_type = $1 AND target_id = $2
--   ORDER BY created_at DESC;
-- target_type + target_id 是典型的组合过滤条件，再加 created_at 排序，
-- 复合索引能一次覆盖 where + order by。
CREATE INDEX IF NOT EXISTS idx_annotations_target_created_at
  ON public.annotations (target_type, target_id, created_at DESC);

-- ========== 4) annotation_replies 的索引 ==========
-- 评论加载第二次往返是 .in('annotation_id', ids) —— 走 annotation_id 单列索引即可。
CREATE INDEX IF NOT EXISTS idx_annotation_replies_annotation_id
  ON public.annotation_replies (annotation_id);

-- ========== 5) document_views 主键已是 document_id，不需要额外索引 ==========

-- ========== 6) guestbook_entries 的时间索引 ==========
-- 热点查询（内部留言板页面加载）：
--   SELECT id,nickname,message,contact,show_contact,created_at
--   FROM guestbook_entries
--   ORDER BY created_at DESC
--   LIMIT 200;
-- 没有索引时，即使只取前 200 条，PostgreSQL 也要把整张表读出来排序，
-- 表体小的时候无感，一旦留言累积到几百条以上就会显著拖慢内部页加载。
-- 这里加一个单列降序索引，查询直接走索引顺序扫描，O(log N)。
CREATE INDEX IF NOT EXISTS idx_guestbook_entries_created_at
  ON public.guestbook_entries (created_at DESC);

-- ============================================
-- 6) 原子浏览计数 RPC：increment_document_view
-- ============================================
-- 业务等价于：INSERT ... ON CONFLICT (document_id) DO UPDATE SET view_count = view_count + 1
-- 一次网络往返、原子 +1，避免前端老实现的 "select 再 upsert" 两次往返
-- 以及并发下 view_count 覆盖丢计数的问题。
--
-- 返回新的 view_count 给前端做 UI 展示。
CREATE OR REPLACE FUNCTION public.increment_document_view(p_document_id text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  INSERT INTO public.document_views (document_id, view_count, updated_at)
  VALUES (p_document_id, 1, now())
  ON CONFLICT (document_id)
  DO UPDATE SET
    view_count = public.document_views.view_count + 1,
    updated_at = now()
  RETURNING view_count INTO v_count;

  RETURN v_count;
END;
$$;

-- 权限：允许已登录用户调用
GRANT EXECUTE ON FUNCTION public.increment_document_view(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_document_view(text) TO anon;

-- ============================================
-- 执行完成后，可用下面的查询验证索引已生效：
--   EXPLAIN ANALYZE SELECT editor_id, editor_name, edited_at, changes
--   FROM document_edit_logs
--   WHERE document_id = '某个真实 id'
--   ORDER BY edited_at DESC LIMIT 200;
-- 期待在 QUERY PLAN 里看到 Index Scan using idx_document_edit_logs_doc_edited_at
-- 而不是 Seq Scan。
-- ============================================
