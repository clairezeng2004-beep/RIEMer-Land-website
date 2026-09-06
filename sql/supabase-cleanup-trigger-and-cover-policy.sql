-- ================================================================
-- 收尾修复：去重触发器 + 管理员封面清理策略
-- ================================================================
-- 幂等、可重复执行；不删除/迁移任何业务数据。
-- 依赖：public.handle_new_member_profile()、public.profiles、
--       storage bucket 'article-covers' 已存在（见 supabase-setup.sql /
--       supabase-fix.sql / supabase-article-covers.sql）。

-- ----------------------------------------------------------------
-- #2 去除 profiles 上重复的授权触发器
-- ----------------------------------------------------------------
-- 历史上 setup/fix 建了 on_user_authorized，members-and-albums 又建了
-- on_profile_authorized，两者绑定同一函数、同一 AFTER UPDATE 事件，
-- 导致每次 profiles 更新时函数被触发两次（幂等无害，但属冗余）。
-- 这里统一收敛为「只保留一个」：先都删掉，再重建唯一的 on_user_authorized。
DROP TRIGGER IF EXISTS on_profile_authorized ON public.profiles;
DROP TRIGGER IF EXISTS on_user_authorized ON public.profiles;
CREATE TRIGGER on_user_authorized
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_member_profile();

-- ----------------------------------------------------------------
-- #3 允许管理员删除任意文章封面（孤儿文件清理兜底）
-- ----------------------------------------------------------------
-- 现有策略 article_covers_auth_delete_own 只允许对象 owner 本人删除。
-- 但两种场景需要跨用户清理：
--   1) 管理员替换他人文章封面（updateArticleInDb 里清理旧封面）；
--   2) 管理员在回收站彻底删除他人文章（purgeItem 里回收封面）。
-- 追加一条「管理员可删任意封面」的策略；RLS 多策略取并集，
-- 普通作者仍只能删自己的封面，管理员额外可删全部。
DROP POLICY IF EXISTS "article_covers_admin_delete_any" ON storage.objects;
CREATE POLICY "article_covers_admin_delete_any"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'article-covers'
  AND (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'admin'
);
