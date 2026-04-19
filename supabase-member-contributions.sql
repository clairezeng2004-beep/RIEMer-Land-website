-- ============================================
-- 成员贡献 — "其他"自定义项跨设备同步
-- ============================================
-- 背景：MemberContributions 页面"其他"栏位原本只存 localStorage
-- （riemer_custom_contributions），不同设备/浏览器互相不可见。
-- 本脚本新增 member_contributions 表，按 (member_id, period_key) 唯一，
-- items 以 JSONB 数组存放 [{ text, date }]。
--
-- 前端代码：src/pages/internal/MemberContributions.jsx
-- 本脚本幂等，可多次执行；新部署也已在 supabase-setup.sql 中包含同一张表。
-- ============================================

CREATE TABLE IF NOT EXISTS public.member_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- member_id 与前端 filterOptions.teamMembers 的 id 对应：
  -- 可能是 UUID（已授权用户），也可能是硬编码字符串（兼容默认 teamMembers），
  -- 因此这里用 TEXT 而不是 UUID。
  member_id TEXT NOT NULL,
  period_key TEXT NOT NULL,              -- 'all' / '2026-H1' / '2025-H2' ...
  items JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ text: string, date: 'YYYY-MM-DD' }]
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

-- 所有已认证用户可查看（团队协作场景）
CREATE POLICY "认证用户可查看成员贡献"
  ON public.member_contributions FOR SELECT
  TO authenticated
  USING (true);

-- 所有已认证用户可新增/更新/删除（与 tasks / documents 的策略保持一致）
CREATE POLICY "认证用户可新增成员贡献"
  ON public.member_contributions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "认证用户可更新成员贡献"
  ON public.member_contributions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "认证用户可删除成员贡献"
  ON public.member_contributions FOR DELETE
  TO authenticated
  USING (true);

-- Realtime 发布（其它设备自动收到新增/删除）
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.member_contributions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
