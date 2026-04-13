// ============================================
// Supabase Keep-Alive — 防止免费项目因不活跃被暂停
// ============================================
// Supabase 免费项目 7 天无活动会被暂停（pause）。
// 此 API 通过 Vercel Cron 每 3 天自动执行一次轻量查询，
// 保持数据库活跃状态。
//
// 手动测试：访问 https://your-domain.vercel.app/api/keep-alive
// ============================================

export default async function handler(req, res) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      ok: false,
      error: 'Supabase 环境变量未配置',
    });
  }

  const timestamp = new Date().toISOString();

  try {
    // 1. 轻量查询 profiles 表（只取 1 条，几乎零开销）
    const dbRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=id&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!dbRes.ok) {
      const errorText = await dbRes.text();
      return res.status(502).json({
        ok: false,
        error: `Supabase 查询失败: ${dbRes.status}`,
        detail: errorText,
        timestamp,
      });
    }

    const data = await dbRes.json();

    // 2. 同时 ping Auth 服务，确保认证服务也保持活跃
    const authRes = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: {
        apikey: supabaseKey,
      },
    });

    return res.status(200).json({
      ok: true,
      message: 'Supabase keep-alive ping 成功 ✓',
      database: {
        status: 'active',
        rowsReturned: data.length,
      },
      auth: {
        status: authRes.ok ? 'active' : 'unreachable',
      },
      timestamp,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message,
      timestamp,
    });
  }
}
