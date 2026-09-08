-- ============================================================
-- 一次性清理：剥掉 documents.likes 里内嵌的 base64 头像
-- ============================================================
-- 背景：早期 handleLike 把整段 base64 头像（user.avatar）写进了每条 like，
--       而列表查询会一次性拉取所有文档的 likes 列 → 首屏被无用的头像数据拖慢。
--       前端只用 userId 计数 + userName 显示名字，从不渲染点赞者头像。
--
-- 代码侧已在 documentsService.sanitizeLikes 读写两侧阻断新写入；
-- 这段 SQL 负责把「历史数据」里已经存进去的头像清掉，让列表体积立刻降下来。
--
-- 用法：Supabase 控制台 → SQL Editor → 粘贴执行。安全、幂等，可重复运行。
-- 建议先跑「预检」看看有多少行受影响，再跑「清理」。

-- ---------- 预检：哪些行的 likes 里还带着 userAvatar ----------
select
  id,
  title,
  jsonb_array_length(likes)              as like_count,
  length(likes::text)                    as likes_bytes
from documents
where likes is not null
  and jsonb_typeof(likes) = 'array'
  and likes::text like '%userAvatar%'
order by likes_bytes desc;

-- ---------- 清理：只保留 userId / userName ----------
update documents
set likes = coalesce((
  select jsonb_agg(
    jsonb_build_object('userId', elem->'userId', 'userName', elem->'userName')
  )
  from jsonb_array_elements(likes) elem
), '[]'::jsonb)
where likes is not null
  and jsonb_typeof(likes) = 'array'
  and jsonb_array_length(likes) > 0
  and likes::text like '%userAvatar%';

-- ---------- 复检：应返回 0 行 ----------
select count(*) as remaining_rows_with_avatar
from documents
where likes::text like '%userAvatar%';
