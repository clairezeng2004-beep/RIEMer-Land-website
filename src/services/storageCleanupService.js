import { supabase } from '../lib/supabase';

// 删除后复查对象，避免 Storage RLS 静默跳过后被误判为成功；支持重试已不存在的文件。
export async function removeStorageObjects(bucket, paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return;
  if (!supabase) throw new Error('存储服务未连接，文件尚未清理。');
  for (let offset = 0; offset < unique.length; offset += 100) {
    const { error } = await supabase.storage.from(bucket).remove(unique.slice(offset, offset + 100));
    if (error) throw new Error(`文件清理失败：${error.message}`);
  }
  for (const path of unique) {
    const slash = path.lastIndexOf('/');
    const directory = slash < 0 ? '' : path.slice(0, slash);
    const name = path.slice(slash + 1);
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.storage.from(bucket).list(directory, {
        search: name, limit: 100, offset, sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`无法确认文件已清理：${error.message}`);
      if (!Array.isArray(data)) throw new Error('无法确认文件清理结果，请稍后重试。');
      if (data.some((item) => item.name === name)) {
        throw new Error('文件仍在存储中，请检查删除权限后重试。');
      }
      if (!data || data.length < 100) break;
    }
  }
}
