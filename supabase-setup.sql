-- ============================================
-- RIEMer Land — Supabase 数据库初始化脚本
-- ============================================
-- 在 Supabase 控制台的 SQL Editor 中运行此脚本
-- 它会创建：
--   1. profiles 表（存储用户角色和授权信息）
--   2. Row Level Security (RLS) 策略
--   3. 自动创建 profile 的触发器
-- ============================================

-- 1. 创建 profiles 表
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  avatar TEXT DEFAULT NULL,
  signature TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  authorized BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 启用 RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 3. RLS 策略（先删除已有策略，避免重复创建报错）

DROP POLICY IF EXISTS "所有认证用户可查看 profiles" ON profiles;
DROP POLICY IF EXISTS "匿名用户可查看已授权成员公开信息" ON profiles;
DROP POLICY IF EXISTS "用户可更新自己的基本信息" ON profiles;
DROP POLICY IF EXISTS "管理员可管理用户" ON profiles;
DROP POLICY IF EXISTS "允许插入 profile" ON profiles;

-- 所有已认证用户可以查看 profiles（用于用户列表）
CREATE POLICY "所有认证用户可查看 profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- 匿名用户可查看已授权成员的公开信息（"关于我们"页面需要）
CREATE POLICY "匿名用户可查看已授权成员公开信息"
  ON profiles FOR SELECT
  TO anon
  USING (authorized = true);

-- 用户可以更新自己的基本信息（但不能改角色和授权状态）
CREATE POLICY "用户可更新自己的基本信息"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
    AND authorized = (SELECT authorized FROM profiles WHERE id = auth.uid())
  );

-- owner 和 admin 可以更新其他用户的角色和授权状态
CREATE POLICY "管理员可管理用户"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 允许插入新的 profile（注册时使用）
CREATE POLICY "允许插入 profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- 4. 自动创建 profile 的触发器函数
-- 注意：会自动检查 pre_authorized_emails 表，若邮箱已被预授权则直接设 authorized=true
--       并自动从预授权列表中移除该邮箱
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  is_pre_authorized BOOLEAN := false;
BEGIN
  -- 检查该邮箱是否在预授权列表中（忽略大小写）
  SELECT EXISTS(
    SELECT 1 FROM public.pre_authorized_emails
    WHERE lower(email) = lower(NEW.email)
  ) INTO is_pre_authorized;

  INSERT INTO public.profiles (id, email, name, nickname, avatar, signature, role, authorized)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    '',
    NULL,
    '',
    'member',
    is_pre_authorized
  );

  -- 如果是预授权用户，从预授权列表中移除
  IF is_pre_authorized THEN
    DELETE FROM public.pre_authorized_emails WHERE lower(email) = lower(NEW.email);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 在用户注册时自动创建 profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 6. 创建 member_profiles 表（成员信息表格）
-- ============================================
CREATE TABLE IF NOT EXISTS member_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  enrollment_year TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  further_education TEXT DEFAULT '',
  career TEXT DEFAULT '',
  willing_to_share TEXT DEFAULT '',
  want_to_learn TEXT DEFAULT '',
  career_interest TEXT DEFAULT '',
  hobbies TEXT DEFAULT '',
  favorites TEXT DEFAULT '',
  hometown TEXT DEFAULT '',
  dream_city TEXT DEFAULT '',
  other TEXT DEFAULT '',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. 启用 member_profiles 的 RLS
ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;

-- 8. member_profiles RLS 策略（先删除已有策略）

DROP POLICY IF EXISTS "所有认证用户可查看成员信息" ON member_profiles;
DROP POLICY IF EXISTS "匿名用户可查看成员信息" ON member_profiles;
DROP POLICY IF EXISTS "用户可更新自己的成员信息" ON member_profiles;
DROP POLICY IF EXISTS "管理员可更新所有成员信息" ON member_profiles;
DROP POLICY IF EXISTS "用户可插入自己的成员信息" ON member_profiles;

-- 所有已认证用户可以查看所有成员信息
CREATE POLICY "所有认证用户可查看成员信息"
  ON member_profiles FOR SELECT
  TO authenticated
  USING (true);

-- 匿名用户可查看成员信息（"关于我们"页面需要）
CREATE POLICY "匿名用户可查看成员信息"
  ON member_profiles FOR SELECT
  TO anon
  USING (true);

-- 用户只能编辑自己的成员信息
CREATE POLICY "用户可更新自己的成员信息"
  ON member_profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 管理员可以编辑所有成员信息
CREATE POLICY "管理员可更新所有成员信息"
  ON member_profiles FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 用户可以插入自己的成员信息
CREATE POLICY "用户可插入自己的成员信息"
  ON member_profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 9. 新用户授权后自动创建 member_profiles 记录的触发器
CREATE OR REPLACE FUNCTION public.handle_new_member_profile()
RETURNS TRIGGER AS $$
BEGIN
  -- 当用户被授权时，自动创建 member_profiles 记录
  IF NEW.authorized = true AND (OLD.authorized IS NULL OR OLD.authorized = false) THEN
    INSERT INTO public.member_profiles (user_id, joined_at)
    VALUES (NEW.id, COALESCE(NEW.created_at, now()))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_authorized ON profiles;
CREATE TRIGGER on_user_authorized
  AFTER UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_member_profile();

-- 10. 为已有的已授权用户补建 member_profiles 记录
INSERT INTO member_profiles (user_id, joined_at)
SELECT id, created_at FROM profiles WHERE authorized = true
ON CONFLICT (user_id) DO NOTHING;

-- ============================================
-- 11. 创建 notifications 表（跨设备通知同步）
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'system' CHECK (type IN ('reminder', 'info', 'system')),
  date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  target_role TEXT DEFAULT NULL,  -- NULL=所有人, 'admin'=仅管理员
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. 启用 notifications 的 RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 所有已认证用户可以查看通知（先删除已有策略）
DROP POLICY IF EXISTS "所有认证用户可查看通知" ON notifications;
DROP POLICY IF EXISTS "允许插入通知" ON notifications;
DROP POLICY IF EXISTS "允许匿名插入通知" ON notifications;
DROP POLICY IF EXISTS "管理员可删除通知" ON notifications;

CREATE POLICY "所有认证用户可查看通知"
  ON notifications FOR SELECT
  TO authenticated
  USING (true);

-- 允许插入通知（注册触发器和应用代码都需要）
CREATE POLICY "允许插入通知"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 匿名用户也可以插入通知（注册时用户尚未认证）
CREATE POLICY "允许匿名插入通知"
  ON notifications FOR INSERT
  TO anon
  WITH CHECK (true);

-- 管理员可以删除通知
CREATE POLICY "管理员可删除通知"
  ON notifications FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 13. 创建 notification_reads 表（记录每个用户的已读状态）
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "用户可查看自己的已读状态" ON notification_reads;
DROP POLICY IF EXISTS "用户可标记自己的已读" ON notification_reads;

CREATE POLICY "用户可查看自己的已读状态"
  ON notification_reads FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "用户可标记自己的已读"
  ON notification_reads FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 14. 新用户注册后的授权通知由应用代码（AuthContext.jsx register 函数）负责插入，
--     无需数据库触发器，避免重复通知。

-- ============================================
-- 15. 创建 pre_authorized_emails 表（管理员预授权邮箱）
-- ============================================
-- 管理员可以提前输入邮箱授权，用户注册时自动匹配并获得访问权限
CREATE TABLE IF NOT EXISTS pre_authorized_emails (
  email TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 16. 启用 pre_authorized_emails 的 RLS
ALTER TABLE pre_authorized_emails ENABLE ROW LEVEL SECURITY;

-- 所有已认证用户可以查看预授权列表（先删除已有策略）
DROP POLICY IF EXISTS "所有认证用户可查看预授权列表" ON pre_authorized_emails;
DROP POLICY IF EXISTS "管理员可添加预授权邮箱" ON pre_authorized_emails;
DROP POLICY IF EXISTS "管理员可删除预授权邮箱" ON pre_authorized_emails;
DROP POLICY IF EXISTS "匿名用户可查看预授权列表" ON pre_authorized_emails;

CREATE POLICY "所有认证用户可查看预授权列表"
  ON pre_authorized_emails FOR SELECT
  TO authenticated
  USING (true);

-- 管理员可以添加预授权邮箱
CREATE POLICY "管理员可添加预授权邮箱"
  ON pre_authorized_emails FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 管理员可以删除预授权邮箱
CREATE POLICY "管理员可删除预授权邮箱"
  ON pre_authorized_emails FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 匿名用户可以查看预授权列表（注册时需要检查）
CREATE POLICY "匿名用户可查看预授权列表"
  ON pre_authorized_emails FOR SELECT
  TO anon
  USING (true);

-- ============================================
-- 17. 创建 guestbook_entries 表（访客留言板）
-- ============================================
-- 公开页面的访客可以留言给网站建设者，可选择是否留联系方式
CREATE TABLE IF NOT EXISTS guestbook_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname TEXT NOT NULL DEFAULT '匿名访客',
  message TEXT NOT NULL,
  contact TEXT DEFAULT '',          -- 可选联系方式（邮箱/微信/手机等）
  show_contact BOOLEAN NOT NULL DEFAULT false,  -- 是否愿意留联系方式
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 18. 启用 guestbook_entries 的 RLS
ALTER TABLE guestbook_entries ENABLE ROW LEVEL SECURITY;

-- 所有人（包括匿名用户）可以插入留言（先删除已有策略）
DROP POLICY IF EXISTS "所有人可留言" ON guestbook_entries;
DROP POLICY IF EXISTS "认证用户可查看留言" ON guestbook_entries;
DROP POLICY IF EXISTS "管理员可删除留言" ON guestbook_entries;

CREATE POLICY "所有人可留言"
  ON guestbook_entries FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 所有已认证用户可以查看留言（内部空间展示）
CREATE POLICY "认证用户可查看留言"
  ON guestbook_entries FOR SELECT
  TO authenticated
  USING (true);

-- 管理员可以删除留言
CREATE POLICY "管理员可删除留言"
  ON guestbook_entries FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- ============================================
-- 18. 创建 articles 表（公众号文章归档）
-- ============================================
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  raw_title TEXT DEFAULT '',
  author TEXT DEFAULT 'RIEMer Land',
  date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  category TEXT DEFAULT '经验分享',
  tags TEXT[] DEFAULT '{}',
  excerpt TEXT DEFAULT '',
  outline TEXT[] DEFAULT '{}',
  url TEXT DEFAULT '',
  content TEXT DEFAULT '',
  cover_image TEXT DEFAULT NULL,
  archived_by TEXT DEFAULT '未知',
  archived_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  read_num INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 19. 启用 articles 的 RLS
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- 20. articles RLS 策略
DROP POLICY IF EXISTS "所有认证用户可查看文章" ON articles;
DROP POLICY IF EXISTS "匿名用户可查看文章" ON articles;
DROP POLICY IF EXISTS "认证用户可添加文章" ON articles;
DROP POLICY IF EXISTS "管理员可更新文章" ON articles;
DROP POLICY IF EXISTS "管理员可删除文章" ON articles;

CREATE POLICY "所有认证用户可查看文章"
  ON articles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "匿名用户可查看文章"
  ON articles FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "认证用户可添加文章"
  ON articles FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "管理员可更新文章"
  ON articles FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    OR archived_by_id = auth.uid()
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    OR archived_by_id = auth.uid()
  );

CREATE POLICY "管理员可删除文章"
  ON articles FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    OR archived_by_id = auth.uid()
  );

-- ============================================
-- 19. 创建 tasks 表（事项追踪）
-- ============================================
-- 内部空间"事项追踪"模块使用，存储所有团队任务。
-- 前端代码：src/pages/internal/Tasks.jsx
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '待启动',
  assignee JSONB NOT NULL DEFAULT '[]'::jsonb,
  helpers JSONB NOT NULL DEFAULT '[]'::jsonb,
  status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 亮点总结 / 经验复盘：随任务持久化，非状态切换时的一次性 reason
  highlights TEXT NOT NULL DEFAULT '',
  reflections TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 老库增量迁移：v3 新增 highlights / reflections
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS highlights TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reflections TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "认证用户可查看事项" ON tasks;
DROP POLICY IF EXISTS "认证用户可新增事项" ON tasks;
DROP POLICY IF EXISTS "认证用户可更新事项" ON tasks;
DROP POLICY IF EXISTS "认证用户可删除事项" ON tasks;

-- 所有已认证用户可查看
CREATE POLICY "认证用户可查看事项"
  ON tasks FOR SELECT
  TO authenticated
  USING (true);

-- 所有已认证用户可插入（团队协作，任何成员都能新建事项）
CREATE POLICY "认证用户可新增事项"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 所有已认证用户可更新（如改状态、补备注）
CREATE POLICY "认证用户可更新事项"
  ON tasks FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 所有已认证用户可删除（如需更严可改成仅 admin）
CREATE POLICY "认证用户可删除事项"
  ON tasks FOR DELETE
  TO authenticated
  USING (true);

-- ============================================
-- 20. 创建 documents 表（流程模板 / 规章制度等文档，跨设备同步）
-- ============================================
-- 内部空间"流程模板文件"模块使用，存储所有用户发布的文档（含正文/附件/点赞）。
-- 前端代码：
--   - src/pages/internal/Documents.jsx          （列表 + 上传）
--   - src/pages/internal/ProcessTemplateCreate.jsx （独立发布页）
--   - src/pages/internal/ProcessTemplateDetail.jsx （详情/编辑）
--
-- 设计说明：
--   - 附件文件本体存入 Supabase Storage 的 documents bucket；
--     documents.attachments 只存文件名、大小、公开 URL 和 storagePath 等元信息。
--   - content 直接存 Markdown 源文或清洗过的 Word-HTML 片段。
--   - likes 用 JSONB 数组，元素形如 { userId, userName, userAvatar }。
--   - deleted_default_ids 也放到这里是不合适的 —— 默认模拟数据的"已删除"
--     标记改用单独的 documents_deleted_defaults 表，保证跨设备一致。
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,                          -- 前端生成的 'doc-xxx' / 时间戳 id，保持兼容
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'process',         -- process / regulation / course / history / experience / custom_*
  description TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'word',          -- word / markdown
  content TEXT NOT NULL DEFAULT '',             -- 正文（HTML 或 Markdown）
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ id, name, size, type, url, storagePath }]
  file_type TEXT DEFAULT NULL,                  -- pdf / docx / xlsx / pptx / image（主文件类型）
  file_url TEXT DEFAULT NULL,                   -- 主文件 URL（向后兼容旧 dataUrl）
  size_text TEXT DEFAULT '—',                   -- 展示用大小
  uploaded_by TEXT DEFAULT 'Unknown',
  uploaded_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  view_count INTEGER NOT NULL DEFAULT 0,
  likes JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_edited_at TEXT DEFAULT NULL,
  last_edited_by TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents (type);

-- 流程模板附件存储桶。文件本体不再塞进 documents JSONB，避免大附件导致
-- PostgREST 请求体过大或跨设备拉取失败。
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "认证用户可读取流程模板附件" ON storage.objects;
DROP POLICY IF EXISTS "认证用户可上传流程模板附件" ON storage.objects;
DROP POLICY IF EXISTS "认证用户可更新流程模板附件" ON storage.objects;
DROP POLICY IF EXISTS "认证用户可删除流程模板附件" ON storage.objects;

CREATE POLICY "认证用户可读取流程模板附件"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'documents');

CREATE POLICY "认证用户可上传流程模板附件"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "认证用户可更新流程模板附件"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'documents')
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "认证用户可删除流程模板附件"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'documents');

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "认证用户可查看文档" ON documents;
DROP POLICY IF EXISTS "认证用户可新增文档" ON documents;
DROP POLICY IF EXISTS "认证用户可更新文档" ON documents;
DROP POLICY IF EXISTS "管理员或作者可更新文档" ON documents;
DROP POLICY IF EXISTS "管理员或作者可删除文档" ON documents;

-- 所有已认证用户可查看所有文档
CREATE POLICY "认证用户可查看文档"
  ON documents FOR SELECT
  TO authenticated
  USING (true);

-- 所有已认证用户可新增文档
CREATE POLICY "认证用户可新增文档"
  ON documents FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 管理员或作者可更新（编辑标题、正文、点赞等）
-- 注意：点赞也走 UPDATE，所以条件里允许所有已认证用户对 likes 字段做修改较麻烦，
-- 这里采用与 articles 一致的宽松策略：管理员 + 作者；点赞改为独立表也可以，
-- 但为了最小改动，先允许所有认证用户 UPDATE（协作团队场景，信任边界在登录鉴权）。
CREATE POLICY "认证用户可更新文档"
  ON documents FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 管理员或作者可删除
CREATE POLICY "管理员或作者可删除文档"
  ON documents FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    OR uploaded_by_id = auth.uid()
  );

-- ============================================
-- 21. 创建 documents_deleted_defaults 表（被管理员删除的默认模拟文档 id 列表）
-- ============================================
-- documentsData 里有一批 hardcode 的默认示例文档，管理员可以删除它们。
-- 之前"删除记录"只写在单机 localStorage，导致另一台设备又看到这些默认数据。
-- 改为数据库共享状态，保证跨设备一致。
CREATE TABLE IF NOT EXISTS documents_deleted_defaults (
  default_id TEXT PRIMARY KEY,                  -- siteData.documentsData 里的 id（string）
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE documents_deleted_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "认证用户可查看已删除默认文档" ON documents_deleted_defaults;
DROP POLICY IF EXISTS "认证用户可标记删除默认文档" ON documents_deleted_defaults;
DROP POLICY IF EXISTS "管理员可恢复默认文档" ON documents_deleted_defaults;

CREATE POLICY "认证用户可查看已删除默认文档"
  ON documents_deleted_defaults FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "认证用户可标记删除默认文档"
  ON documents_deleted_defaults FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "管理员可恢复默认文档"
  ON documents_deleted_defaults FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- ============================================
-- 22. 创建 document_views 表（流程模板/文档的浏览计数，跨设备累计）
-- ============================================
-- 原来 riemer_process_template_views 只存本地，每台设备各算各的 —— 合到云端后
-- 可以展示整个团队的真实浏览量。
CREATE TABLE IF NOT EXISTS document_views (
  document_id TEXT PRIMARY KEY,
  view_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE document_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "认证用户可查看浏览计数" ON document_views;
DROP POLICY IF EXISTS "认证用户可更新浏览计数" ON document_views;
DROP POLICY IF EXISTS "认证用户可增量浏览计数" ON document_views;

CREATE POLICY "认证用户可查看浏览计数"
  ON document_views FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "认证用户可更新浏览计数"
  ON document_views FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "认证用户可增量浏览计数"
  ON document_views FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 24. 创建 annotations 表（文本划线评论 / 全站共享）
-- ============================================
-- 任何已授权用户都能对"文章 / 文档 / 内部分享 / 流程模板" 等内容
-- 进行划线评论和回复；评论对所有登录用户可见。
CREATE TABLE IF NOT EXISTS annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL,          -- 'article' | 'document' | 'sharing' | 'template'
  target_id TEXT NOT NULL,            -- 对应内容 id（可能是 UUID 或前端生成的字符串）
  selected_text TEXT NOT NULL DEFAULT '', -- 划中的原文（空串表示整体评论）
  anchor_data JSONB,                  -- 高亮锚点（contextBefore / contextAfter 等）
  content TEXT NOT NULL,              -- 评论正文
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL DEFAULT '',
  user_avatar TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annotations_target
  ON annotations (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_annotations_user
  ON annotations (user_id);

-- 25. 创建 annotation_replies 表（评论回复）
CREATE TABLE IF NOT EXISTS annotation_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  annotation_id UUID NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL DEFAULT '',
  user_avatar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annotation_replies_annotation
  ON annotation_replies (annotation_id);

-- 26. RLS —— annotations
ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "认证用户可查看所有划线评论" ON annotations;
DROP POLICY IF EXISTS "认证用户可新增自己的划线评论" ON annotations;
DROP POLICY IF EXISTS "作者或管理员可更新划线评论" ON annotations;
DROP POLICY IF EXISTS "作者或管理员可删除划线评论" ON annotations;

CREATE POLICY "认证用户可查看所有划线评论"
  ON annotations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "认证用户可新增自己的划线评论"
  ON annotations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 作者本人或管理员可更新（例如标记"已解决"）
CREATE POLICY "作者或管理员可更新划线评论"
  ON annotations FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    auth.uid() = user_id
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 作者本人或管理员可删除
CREATE POLICY "作者或管理员可删除划线评论"
  ON annotations FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 27. RLS —— annotation_replies
ALTER TABLE annotation_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "认证用户可查看所有评论回复" ON annotation_replies;
DROP POLICY IF EXISTS "认证用户可新增自己的评论回复" ON annotation_replies;
DROP POLICY IF EXISTS "作者或管理员可删除评论回复" ON annotation_replies;

CREATE POLICY "认证用户可查看所有评论回复"
  ON annotation_replies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "认证用户可新增自己的评论回复"
  ON annotation_replies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "作者或管理员可删除评论回复"
  ON annotation_replies FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- ============================================
-- 初始设置完成后，手动操作：
-- 1. 注册你的账号（通过网站或 Supabase Dashboard）
-- 2. 在 Supabase SQL Editor 中运行以下命令，
--    将你的账号设为管理员：
--
--    UPDATE profiles
--    SET role = 'admin', authorized = true
--    WHERE email = '你的邮箱@example.com';
-- ============================================


-- ============================================
-- site_settings：站点级全局配置（跨设备同步）
-- 用于保存管理员在"所见即所得"编辑模式下修改的内部空间配置
-- （侧边栏 Tab 名称、各页面标题、提示文案等）
-- ============================================
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- 所有已登录用户都可读（内部空间配置需要所有成员加载）
DROP POLICY IF EXISTS "site_settings read" ON site_settings;
CREATE POLICY "site_settings read"
  ON site_settings
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 只有管理员可写入 / 更新
DROP POLICY IF EXISTS "site_settings write admin" ON site_settings;
CREATE POLICY "site_settings write admin"
  ON site_settings
  FOR ALL
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- 启用 realtime 订阅（其它设备在管理员保存后自动刷新）
-- 若报 "already member" 可忽略
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE site_settings;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 其它跨设备数据表的 realtime 发布
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE articles;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE documents;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE documents_deleted_defaults;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 相册功能：albums + album_photos + album-photos bucket
-- ============================================
CREATE TABLE IF NOT EXISTS public.albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  date TEXT DEFAULT '',
  cover_index INT DEFAULT 0,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_albums_date ON public.albums(date DESC);

CREATE TABLE IF NOT EXISTS public.album_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_path TEXT,
  caption TEXT DEFAULT '',
  sort_index INT DEFAULT 0,
  uploaded_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_album_photos_album_id ON public.album_photos(album_id);
CREATE INDEX IF NOT EXISTS idx_album_photos_sort ON public.album_photos(album_id, sort_index);

ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.album_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "albums_select_auth" ON public.albums
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "albums_insert_auth" ON public.albums
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "albums_update_owner_or_admin" ON public.albums
  FOR UPDATE TO authenticated
  USING (
    created_by_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
  );
CREATE POLICY "albums_delete_owner_or_admin" ON public.albums
  FOR DELETE TO authenticated
  USING (
    created_by_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
  );

CREATE POLICY "album_photos_select_auth" ON public.album_photos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "album_photos_insert_auth" ON public.album_photos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "album_photos_update_uploader_or_admin" ON public.album_photos
  FOR UPDATE TO authenticated
  USING (
    uploaded_by_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
    OR EXISTS (
      SELECT 1 FROM public.albums a
      WHERE a.id = album_id AND a.created_by_id = auth.uid()
    )
  );
CREATE POLICY "album_photos_delete_uploader_or_admin" ON public.album_photos
  FOR DELETE TO authenticated
  USING (
    uploaded_by_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
    OR EXISTS (
      SELECT 1 FROM public.albums a
      WHERE a.id = album_id AND a.created_by_id = auth.uid()
    )
  );

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.albums;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.album_photos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('album-photos', 'album-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "album_photos_public_read" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'album-photos');
CREATE POLICY "album_photos_auth_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'album-photos');
CREATE POLICY "album_photos_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'album-photos'
    AND (
      owner = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
    )
  );
CREATE POLICY "album_photos_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'album-photos'
    AND (
      owner = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','owner')
    )
  );

-- ============================================
-- 成员贡献 — member_contributions（"其他"自定义项跨设备同步）
-- ============================================
-- 前端：src/pages/internal/MemberContributions.jsx
-- 按 (member_id, period_key) 唯一，items 以 JSONB 数组存放 [{ text, date }]。
CREATE TABLE IF NOT EXISTS public.member_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT member_contributions_member_period_uniq UNIQUE (member_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_member_contributions_member
  ON public.member_contributions (member_id);
CREATE INDEX IF NOT EXISTS idx_member_contributions_period
  ON public.member_contributions (period_key);

ALTER TABLE public.member_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "认证用户可查看成员贡献" ON public.member_contributions;
DROP POLICY IF EXISTS "认证用户可新增成员贡献" ON public.member_contributions;
DROP POLICY IF EXISTS "认证用户可更新成员贡献" ON public.member_contributions;
DROP POLICY IF EXISTS "认证用户可删除成员贡献" ON public.member_contributions;

CREATE POLICY "认证用户可查看成员贡献"
  ON public.member_contributions FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "认证用户可新增成员贡献"
  ON public.member_contributions FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "认证用户可更新成员贡献"
  ON public.member_contributions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "认证用户可删除成员贡献"
  ON public.member_contributions FOR DELETE
  TO authenticated USING (true);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.member_contributions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
