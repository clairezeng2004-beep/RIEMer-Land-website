-- ================================================================
-- 公众号文章批量更新：事务化、带版本校验、遵守现有 RLS
-- ================================================================
-- 本脚本只新增/更新数据库函数，不删除或迁移任何现有文章、配置和封面。
-- 部署顺序：先执行本脚本，再部署调用这些 RPC 的前端代码。

CREATE OR REPLACE FUNCTION public.apply_article_batch_updates(p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_change jsonb;
  v_id uuid;
  v_expected_updated_at timestamptz;
  v_current public.articles%ROWTYPE;
  v_updated_ids uuid[] := ARRAY[]::uuid[];
  v_row_count integer;
  v_articles jsonb := '[]'::jsonb;
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'p_changes 必须是 JSON 数组' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_changes) AS item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'p_changes 的每一项都必须是 JSON 对象' USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT count(*)
    FROM jsonb_array_elements(p_changes) AS item(value)
  ) <> (
    SELECT count(DISTINCT item.value->>'id')
    FROM jsonb_array_elements(p_changes) AS item(value)
  ) THEN
    RAISE EXCEPTION '批量更新中存在重复文章 ID' USING ERRCODE = '22023';
  END IF;

  -- 固定加锁顺序，降低两个批量操作同时更新相同文章时发生死锁的概率。
  FOR v_change IN
    SELECT item.value
      FROM jsonb_array_elements(p_changes) AS item(value)
     ORDER BY item.value->>'id'
  LOOP
    IF EXISTS (
      SELECT 1
      FROM jsonb_object_keys(v_change) AS keys(key_name)
      WHERE key_name NOT IN ('id', 'expected_updated_at', 'category', 'tags', 'read_num')
    ) THEN
      RAISE EXCEPTION '批量更新包含不允许的字段' USING ERRCODE = '22023';
    END IF;

    IF NOT (v_change ? 'id') OR NOT (v_change ? 'expected_updated_at') THEN
      RAISE EXCEPTION '文章 ID 或版本信息缺失' USING ERRCODE = '22023';
    END IF;

    IF NOT (v_change ? 'category') AND NOT (v_change ? 'tags') AND NOT (v_change ? 'read_num') THEN
      RAISE EXCEPTION '文章更新内容为空' USING ERRCODE = '22023';
    END IF;

    v_id := (v_change->>'id')::uuid;
    v_expected_updated_at := (v_change->>'expected_updated_at')::timestamptz;

    SELECT *
      INTO v_current
      FROM public.articles
     WHERE id = v_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '文章不存在或当前账号不可访问：%', v_id USING ERRCODE = 'P0002';
    END IF;

    IF v_current.updated_at IS DISTINCT FROM v_expected_updated_at THEN
      RAISE EXCEPTION '文章已被其他设备修改，请刷新后重试：%', v_id USING ERRCODE = '40001';
    END IF;

    IF v_change ? 'category' AND jsonb_typeof(v_change->'category') <> 'string' THEN
      RAISE EXCEPTION 'category 必须是字符串：%', v_id USING ERRCODE = '22023';
    END IF;
    IF v_change ? 'tags' AND jsonb_typeof(v_change->'tags') <> 'array' THEN
      RAISE EXCEPTION 'tags 必须是数组：%', v_id USING ERRCODE = '22023';
    END IF;
    IF v_change ? 'read_num' AND jsonb_typeof(v_change->'read_num') <> 'number' THEN
      RAISE EXCEPTION 'read_num 必须是数字：%', v_id USING ERRCODE = '22023';
    END IF;
    IF v_change ? 'read_num' AND (v_change->>'read_num')::integer < 0 THEN
      RAISE EXCEPTION 'read_num 不能小于 0：%', v_id USING ERRCODE = '22023';
    END IF;

    UPDATE public.articles
       SET category = CASE
             WHEN v_change ? 'category' THEN v_change->>'category'
             ELSE category
           END,
           tags = CASE
             WHEN v_change ? 'tags' THEN ARRAY(
               SELECT jsonb_array_elements_text(v_change->'tags')
             )
             ELSE tags
           END,
           read_num = CASE
             WHEN v_change ? 'read_num' THEN (v_change->>'read_num')::integer
             ELSE read_num
           END,
           updated_at = now()
     WHERE id = v_id;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION '文章更新未命中，可能没有权限：%', v_id USING ERRCODE = '42501';
    END IF;

    v_updated_ids := array_append(v_updated_ids, v_id);
  END LOOP;

  IF cardinality(v_updated_ids) > 0 THEN
    SELECT COALESCE(
      jsonb_agg(to_jsonb(article_row) ORDER BY array_position(v_updated_ids, article_row.id)),
      '[]'::jsonb
    )
      INTO v_articles
      FROM public.articles AS article_row
     WHERE article_row.id = ANY(v_updated_ids);
  END IF;

  RETURN jsonb_build_object('articles', v_articles);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_article_category_batch(
  p_changes jsonb,
  p_categories jsonb,
  p_expected_setting_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_setting_updated_at timestamptz;
  v_setting_updated_at timestamptz;
  v_updated_ids uuid[] := ARRAY[]::uuid[];
  v_articles jsonb := '[]'::jsonb;
  v_row_count integer;
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'p_changes 必须是 JSON 数组' USING ERRCODE = '22023';
  END IF;
  IF p_categories IS NULL OR jsonb_typeof(p_categories) <> 'array' THEN
    RAISE EXCEPTION 'p_categories 必须是 JSON 数组' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_changes) > 0 THEN
    PERFORM public.apply_article_batch_updates(p_changes);
    SELECT COALESCE(array_agg((item.value->>'id')::uuid), ARRAY[]::uuid[])
      INTO v_updated_ids
      FROM jsonb_array_elements(p_changes) AS item(value);
  END IF;

  SELECT updated_at
    INTO v_current_setting_updated_at
    FROM public.site_settings
   WHERE key = 'article_categories'
   FOR UPDATE;

  IF FOUND THEN
    IF p_expected_setting_updated_at IS NULL
       OR v_current_setting_updated_at IS DISTINCT FROM p_expected_setting_updated_at THEN
      RAISE EXCEPTION '文章系列配置已被其他设备修改，请刷新后重试' USING ERRCODE = '40001';
    END IF;

    UPDATE public.site_settings
       SET value = p_categories,
           updated_at = now()
     WHERE key = 'article_categories';
  ELSE
    IF p_expected_setting_updated_at IS NOT NULL THEN
      RAISE EXCEPTION '文章系列配置状态已变化，请刷新后重试' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.site_settings (key, value, updated_at)
    VALUES ('article_categories', p_categories, now());
  END IF;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION '文章系列配置保存未命中，可能没有权限' USING ERRCODE = '42501';
  END IF;

  SELECT updated_at
    INTO v_setting_updated_at
    FROM public.site_settings
   WHERE key = 'article_categories';

  IF cardinality(v_updated_ids) > 0 THEN
    SELECT COALESCE(
      jsonb_agg(to_jsonb(article_row) ORDER BY array_position(v_updated_ids, article_row.id)),
      '[]'::jsonb
    )
      INTO v_articles
      FROM public.articles AS article_row
     WHERE article_row.id = ANY(v_updated_ids);
  END IF;

  RETURN jsonb_build_object(
    'articles', v_articles,
    'setting_updated_at', v_setting_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_article_batch_updates(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_article_category_batch(jsonb, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_article_batch_updates(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_article_category_batch(jsonb, jsonb, timestamptz) TO authenticated;
