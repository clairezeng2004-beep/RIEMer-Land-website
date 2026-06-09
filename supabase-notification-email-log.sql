-- ============================================
-- 未读消息邮件提醒：发送去重日志表
-- ============================================
-- 配合 api/send-unread-digest.js 使用：
--   定时任务每天运行，给「有未读站内通知」的用户发未读汇总邮件，
--   这张表记录每个用户最近一次发送时间，保证「每人最多每 7 天一封」，
--   不会因为 cron 每天运行就重复轰炸用户。
--
-- 只有服务端（service role，绕过 RLS）读写，不开放给前端。
-- 在 Supabase SQL Editor 执行一次即可（CREATE TABLE IF NOT EXISTS，可重复执行）。
-- ============================================

CREATE TABLE IF NOT EXISTS notification_email_log (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_unread_count INT NOT NULL DEFAULT 0
);

-- 启用 RLS 且不创建任何策略 → 前端（anon/authenticated）无法读写，
-- 只有 service role 密钥能访问（后端定时任务用的就是它）。
ALTER TABLE notification_email_log ENABLE ROW LEVEL SECURITY;
