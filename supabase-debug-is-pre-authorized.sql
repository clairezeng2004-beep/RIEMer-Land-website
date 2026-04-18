-- ================================================================
-- 排查 "relation is_pre_authorized does not exist" 错误
-- 把本文件内容整段贴到 Supabase SQL Editor 执行，看结果即可定位
-- ================================================================

-- 1. 在所有"函数体"里搜 is_pre_authorized 的使用方式
SELECT n.nspname AS schema,
       p.proname AS function_name,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE pg_get_functiondef(p.oid) ILIKE '%is_pre_authorized%'
  AND n.nspname NOT IN ('pg_catalog','information_schema');

-- 2. 在所有"RLS policy"里搜 is_pre_authorized
SELECT schemaname, tablename, policyname, qual, with_check
FROM pg_policies
WHERE (qual ILIKE '%is_pre_authorized%' OR with_check ILIKE '%is_pre_authorized%');

-- 3. 在所有"视图定义"里搜 is_pre_authorized
SELECT table_schema, table_name, view_definition
FROM information_schema.views
WHERE view_definition ILIKE '%is_pre_authorized%';

-- 4. 在所有"触发器定义"里搜 is_pre_authorized
SELECT event_object_schema, event_object_table, trigger_name, action_statement
FROM information_schema.triggers
WHERE action_statement ILIKE '%is_pre_authorized%';

-- 5. 看一下 profiles / pre_authorized_emails 当前有哪些列（顺手确认 authorized 存在）
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profiles','pre_authorized_emails')
ORDER BY table_name, ordinal_position;
