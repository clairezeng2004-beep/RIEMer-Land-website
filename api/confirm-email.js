// ============================================
// Vercel Serverless Function: 确认用户邮箱
// ============================================
// 路径: POST /api/confirm-email
// 使用 Supabase Admin API (Service Role Key) 手动确认用户邮箱
// 用于预授权用户注册后自动跳过邮箱验证
//
// 环境变量:
//   VITE_SUPABASE_URL — Supabase 项目 URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase Service Role Key（有 Admin 权限）
// ============================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: '请提供邮箱地址' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Supabase 配置缺失（需要 VITE_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY）' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // 1. 通过邮箱查找用户（分页遍历所有用户，避免超过50人时漏掉）
    let targetUser = null;
    let page = 1;
    const perPage = 50;

    while (!targetUser) {
      const listRes = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
        {
          headers: {
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
        }
      );

      if (!listRes.ok) {
        const errorText = await listRes.text().catch(() => '');
        console.error('[confirm-email] 获取用户列表失败:', listRes.status, errorText);
        return res.status(500).json({ error: '获取用户列表失败' });
      }

      const { users } = await listRes.json();
      if (!users || users.length === 0) break;

      targetUser = users.find(
        (u) => u.email?.toLowerCase() === normalizedEmail
      );

      if (users.length < perPage) break; // 已经是最后一页
      page++;
    }

    if (!targetUser) {
      return res.status(404).json({ error: '未找到该邮箱对应的用户' });
    }

    // 2. 使用 Admin API 确认邮箱（设置 email_confirm = true）
    const updateRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${targetUser.id}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ email_confirm: true }),
      }
    );

    if (!updateRes.ok) {
      const errorText = await updateRes.text().catch(() => '');
      console.error('[confirm-email] 确认邮箱失败:', updateRes.status, errorText);
      return res.status(500).json({ error: '确认邮箱失败' });
    }

    console.log('[confirm-email] 成功确认邮箱:', normalizedEmail);
    return res.status(200).json({
      success: true,
      message: '邮箱已确认',
    });
  } catch (err) {
    console.error('[confirm-email] 异常:', err);
    return res.status(500).json({ error: '服务异常：' + err.message });
  }
}
