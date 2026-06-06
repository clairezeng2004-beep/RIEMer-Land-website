-- ============================================
-- RIEMer Land — 成员内部分享（MemberSharing）
-- ============================================
-- 功能：将"成员内部分享"从 localStorage 迁移到 Supabase，
-- 支持多设备实时同步（Realtime）。
--
-- 执行方式：在 Supabase Dashboard → SQL Editor 粘贴本文件内容，点击 Run。
-- 可重复执行（幂等）。
--
-- 前端代码：
--   - src/pages/internal/MemberSharing.jsx
--   - src/pages/internal/MemberSharingCreate.jsx
--   - src/pages/internal/MemberSharingDetail.jsx
--   - src/services/memberSharingService.js
-- ============================================

-- ============================================
-- 1. member_sharing 表：存储分享帖
-- ============================================
CREATE TABLE IF NOT EXISTS member_sharing (
  id TEXT PRIMARY KEY,                          -- 保持与前端现有 id 结构一致（sharing-<timestamp>）
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',             -- 分享卡片简介 / 推荐理由 / 使用指南 / 概览
  category TEXT NOT NULL DEFAULT 'experience',  -- 分类 key
  format TEXT NOT NULL DEFAULT 'word',          -- 'word' | 'markdown'
  content TEXT NOT NULL DEFAULT '',             -- 正文（HTML 或 Markdown）
  period TEXT,                                   -- 时间段字符串（如 "2025.06 - 2025.09"）
  attachments JSONB,                             -- 附件元数据数组（新版只存 url/storagePath，不存 dataUrl）
  author TEXT NOT NULL DEFAULT 'Unknown',       -- 作者显示名
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  likes JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{userId, userName}]
  created_at DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE member_sharing
  ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '';

-- 索引
CREATE INDEX IF NOT EXISTS idx_member_sharing_created_at ON member_sharing(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_sharing_category ON member_sharing(category);
CREATE INDEX IF NOT EXISTS idx_member_sharing_author_id ON member_sharing(author_id);

-- 启用 RLS
ALTER TABLE member_sharing ENABLE ROW LEVEL SECURITY;

-- 先删除已有策略，避免重复创建
DROP POLICY IF EXISTS "所有认证用户可查看分享" ON member_sharing;
DROP POLICY IF EXISTS "认证用户可添加分享" ON member_sharing;
DROP POLICY IF EXISTS "作者或管理员可更新分享" ON member_sharing;
DROP POLICY IF EXISTS "认证用户可更新分享点赞" ON member_sharing;
DROP POLICY IF EXISTS "作者或管理员可删除分享" ON member_sharing;

-- 所有已认证用户可以查看所有分享
CREATE POLICY "所有认证用户可查看分享"
  ON member_sharing FOR SELECT
  TO authenticated
  USING (true);

-- 所有已认证用户可以添加分享
CREATE POLICY "认证用户可添加分享"
  ON member_sharing FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 所有已认证用户可以 UPDATE（主要是点赞场景，全员都能 +1）
-- 如果担心越权改内容，可以把此策略换成更严格的"仅作者或管理员"，
-- 但这样点赞就不能由非作者触发。折中方案：允许全员 UPDATE。
CREATE POLICY "认证用户可更新分享点赞"
  ON member_sharing FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 作者或管理员可以删除分享
CREATE POLICY "作者或管理员可删除分享"
  ON member_sharing FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'admin')
    )
  );

-- ============================================
-- 2. member_sharing_categories 表：分类配置
-- ============================================
CREATE TABLE IF NOT EXISTS member_sharing_categories (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#5EAD8C',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 启用 RLS
ALTER TABLE member_sharing_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "所有认证用户可查看分类" ON member_sharing_categories;
DROP POLICY IF EXISTS "认证用户可添加分类" ON member_sharing_categories;
DROP POLICY IF EXISTS "管理员可更新分类" ON member_sharing_categories;
DROP POLICY IF EXISTS "管理员可删除分类" ON member_sharing_categories;

-- 所有认证用户都可以查看分类
CREATE POLICY "所有认证用户可查看分类"
  ON member_sharing_categories FOR SELECT
  TO authenticated
  USING (true);

-- 所有认证用户都可以新增分类（与前端现有行为一致）
CREATE POLICY "认证用户可添加分类"
  ON member_sharing_categories FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 仅管理员可以更新分类
CREATE POLICY "管理员可更新分类"
  ON member_sharing_categories FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'admin')
    )
  );

-- 仅管理员可以删除分类
CREATE POLICY "管理员可删除分类"
  ON member_sharing_categories FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'admin')
    )
  );

-- 插入默认分类（若尚未存在）
INSERT INTO member_sharing_categories (key, label, color, sort_order)
VALUES
  ('course',     '课程资料',     '#5EAD8C', 1),
  ('history',    '历史会议',     '#4FBFC4', 2),
  ('experience', '成员经验分享', '#EC4899', 3)
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- 3. 启用 Realtime（Supabase Realtime）
-- ============================================
-- 注意：必须把表加入 supabase_realtime publication，订阅才会生效
DO $$
BEGIN
  -- member_sharing
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE member_sharing;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;  -- publication 不存在时忽略
  END;

  -- member_sharing_categories
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE member_sharing_categories;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END$$;

-- ============================================
-- 完成
-- ============================================
-- 验证：
--   SELECT * FROM member_sharing;
--   SELECT * FROM member_sharing_categories;
--
-- 前端启用后，localStorage 中的历史数据会在首次加载时自动迁移到云端。
-- ============================================

-- ============================================
-- 4. 附件 Storage bucket
-- ============================================
-- 说明：
--   旧版前端曾把附件转成 base64 dataUrl 后直接塞进 member_sharing.attachments JSONB。
--   这会造成：
--     1) PostgREST 请求体过大，新增/迁移失败；
--     2) localStorage 迅速超限；
--     3) 跨设备同步不稳定。
--   新版前端会把附件本体上传到 Storage，仅在 JSONB 中保存 name/size/type/url/storagePath。

INSERT INTO storage.buckets (id, name, public)
VALUES ('member-sharing-attachments', 'member-sharing-attachments', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "成员分享附件公开读取" ON storage.objects;
DROP POLICY IF EXISTS "认证用户可上传成员分享附件" ON storage.objects;
DROP POLICY IF EXISTS "认证用户可更新成员分享附件" ON storage.objects;
DROP POLICY IF EXISTS "认证用户可删除成员分享附件" ON storage.objects;

CREATE POLICY "成员分享附件公开读取"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'member-sharing-attachments');

CREATE POLICY "认证用户可上传成员分享附件"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'member-sharing-attachments');

CREATE POLICY "认证用户可更新成员分享附件"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'member-sharing-attachments')
  WITH CHECK (bucket_id = 'member-sharing-attachments');

CREATE POLICY "认证用户可删除成员分享附件"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'member-sharing-attachments');
