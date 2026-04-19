-- ============================================================
-- 通知规则表（notification_rules）
-- ============================================================
-- 作用：
--   存储"通知管理"页面中用户自定义的通知触发规则。
--   每条规则描述了"什么事件 → 谁能收到 → 发什么内容 → 附加条件 / 频率限制"。
--   前端通过 NotificationRulesContext 读写；未建此表时会自动降级 localStorage。
--
-- 字段说明：
--   id                      主键；前端生成的短 id
--   event                   触发事件 key，例如 doc.upload / task.status_change
--   title                   通知标题（支持 {变量} 占位符）
--   message_template        通知内容模板（支持 {变量} 占位符）
--   type                    通知类型：progress / sharing / other
--   audience                通知范围：all / operator_exclude / admin / member
--   auto_read_for_operator  操作者自己是否自动已读
--   conditions              附加条件数组，例：
--                           [{"field":"typeLabel","op":"equals","value":"流程手册"}]
--   throttle                频率限制对象，例：{"maxPerDay": 10}
--   enabled                 是否启用
--   description             自然语言描述（前端每次保存时更新）
--   created_at / updated_at 时间戳
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notification_rules (
  id                     TEXT PRIMARY KEY,
  event                  TEXT NOT NULL,
  title                  TEXT NOT NULL,
  message_template       TEXT,
  type                   TEXT NOT NULL DEFAULT 'other',
  audience               TEXT NOT NULL DEFAULT 'operator_exclude',
  auto_read_for_operator BOOLEAN NOT NULL DEFAULT TRUE,
  conditions             JSONB NOT NULL DEFAULT '[]'::JSONB,
  throttle               JSONB NOT NULL DEFAULT '{"maxPerDay":0}'::JSONB,
  enabled                BOOLEAN NOT NULL DEFAULT TRUE,
  description            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 便捷索引：按事件过滤（规则引擎每次事件触发都要查）
CREATE INDEX IF NOT EXISTS notification_rules_event_idx
  ON public.notification_rules (event);

-- 自动维护 updated_at（若 supabase-setup.sql 里已定义此函数则忽略重复创建）
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_rules_updated_at ON public.notification_rules;
CREATE TRIGGER notification_rules_updated_at
  BEFORE UPDATE ON public.notification_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS 策略
--   · 所有已登录用户可读（因为每个人都要展示规则描述 + 引擎要匹配）
--   · 仅 admin 可写（INSERT/UPDATE/DELETE）
--   · 规则表是全局共享的，不按用户分组
-- ============================================================
ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

-- 清除可能残留的旧策略
DROP POLICY IF EXISTS "notification_rules_select_authed" ON public.notification_rules;
DROP POLICY IF EXISTS "notification_rules_admin_write"  ON public.notification_rules;

-- 读：任何登录用户都可读
CREATE POLICY "notification_rules_select_authed"
  ON public.notification_rules
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- 写：仅 profiles.role = 'admin' 可 INSERT/UPDATE/DELETE
-- 依赖 profiles 表（见 supabase-setup.sql / supabase-members-and-albums.sql）
CREATE POLICY "notification_rules_admin_write"
  ON public.notification_rules
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- ============================================================
-- 提示：
--   执行本文件后刷新"通知管理"页面，若云端 notification_rules
--   表为空，前端会自动写入 8 条默认规则作为种子数据。
--   之后所有管理员的"新增 / 编辑 / 停用 / 删除"都会实时写回此表。
-- ============================================================
