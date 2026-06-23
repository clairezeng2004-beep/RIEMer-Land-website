-- ============================================
-- RIEMer Land — 回收站（Recycle Bin）
-- ============================================
-- 功能：内部空间各模块（成员内部分享 / 流程模板文档 / 公众号文章归档 / 活动发布）
-- 删除内容时，先把整条记录的快照挪进本表，支持后续“恢复”或“彻底删除”。
--
-- 设计：统一一张 recycle_bin 表，用 item_type 区分来源，payload 存完整原始对象快照。
--   - 恢复：前端按 item_type 把 payload 回写到各自的源表/源存储；再删掉本表这条。
--   - 彻底删除：只删本表这条（源数据早已从源表移除）。
--
-- 执行方式：Supabase Dashboard → SQL Editor 粘贴本文件 → Run（幂等，可重复执行）。
--
-- 前端代码：
--   - src/services/recycleBinService.js
--   - src/pages/internal/RecycleBin.jsx
-- ============================================

CREATE TABLE IF NOT EXISTS recycle_bin (
  id            TEXT PRIMARY KEY,                 -- 回收站条目 id：rb-<timestamp>-<rand>
  item_type     TEXT NOT NULL,                    -- 'member_sharing' | 'document' | 'article' | 'event'
  original_id   TEXT NOT NULL,                    -- 原记录 id（恢复时回写用）
  title         TEXT,                             -- 展示用标题
  excerpt       TEXT,                             -- 展示用摘要（可空）
  author        TEXT,                             -- 展示用原作者名
  -- 注意：author_id / deleted_by_id 用 TEXT 而非 UUID。
  -- 因为四类来源的作者 id 不一定都是 auth.users 的 UUID（活动存在 JSON 里，
  -- 历史数据可能是本地生成的字符串）。用 TEXT 避免插入时类型报错。
  author_id     TEXT,                             -- 原作者 id（权限：原作者可见/恢复）
  deleted_by    TEXT,                             -- 删除操作者名
  deleted_by_id TEXT,                             -- 删除操作者 id（权限：删除者可恢复）
  payload       JSONB NOT NULL,                   -- 完整原始记录快照
  deleted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recycle_bin_deleted_at ON recycle_bin(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_item_type  ON recycle_bin(item_type);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_author_id  ON recycle_bin(author_id);

ALTER TABLE recycle_bin ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "管理员或原作者可查看回收站" ON recycle_bin;
DROP POLICY IF EXISTS "认证用户可加入回收站" ON recycle_bin;
DROP POLICY IF EXISTS "管理员或原作者可移除回收站条目" ON recycle_bin;

-- 查看：管理员可见全部；原作者或当初执行删除的人可见自己相关的
CREATE POLICY "管理员或原作者可查看回收站"
  ON recycle_bin FOR SELECT
  TO authenticated
  USING (
    author_id = auth.uid()::text
    OR deleted_by_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'admin')
    )
  );

-- 加入回收站：任意已认证用户都能把自己有权删除的内容挪进来
CREATE POLICY "认证用户可加入回收站"
  ON recycle_bin FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 移除条目（恢复成功后删本表行，或彻底删除）：管理员、原作者、删除者均可
CREATE POLICY "管理员或原作者可移除回收站条目"
  ON recycle_bin FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()::text
    OR deleted_by_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'admin')
    )
  );

-- 启用 Realtime（其它设备删除/恢复时本页实时刷新）
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE recycle_bin;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END$$;

-- 验证：
--   SELECT id, item_type, title, deleted_at FROM recycle_bin ORDER BY deleted_at DESC;
