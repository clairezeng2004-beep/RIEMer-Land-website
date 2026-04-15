// ============================================
// Vercel Serverless Function: 预授权用户注册
// ============================================
// 路径: POST /api/register-preauth
// 使用 Supabase Admin API (Service Role Key) 直接创建已确认的用户
// 不会触发 Supabase 发送确认邮件
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

  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: '请提供邮箱和密码' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Supabase 配置缺失' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // 使用 Admin API 创建用户，email_confirm: true 表示直接确认邮箱
    // 这样 Supabase 不会发送确认邮件
    const createRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          email_confirm: true,
          user_metadata: { name: name || '' },
        }),
      }
    );

    if (!createRes.ok) {
      const errorData = await createRes.json().catch(() => ({}));
      const errorMsg = errorData.msg || errorData.message || errorData.error || '创建用户失败';

      // 检查是否是"用户已存在"的错误
      if (createRes.status === 422 || errorMsg.includes('already') || errorMsg.includes('exists')) {
        return res.status(409).json({ error: '该邮箱已被注册' });
      }

      console.error('[register-preauth] 创建用户失败:', createRes.status, errorMsg);
      return res.status(500).json({ error: errorMsg });
    }

    const userData = await createRes.json();

    console.log('[register-preauth] 成功创建预授权用户:', normalizedEmail, 'id:', userData.id);
    return res.status(200).json({
      success: true,
      user: {
        id: userData.id,
        email: userData.email,
      },
      message: '注册成功（邮箱已自动确认）',
    });
  } catch (err) {
    console.error('[register-preauth] 异常:', err);
    return res.status(500).json({ error: '服务异常：' + err.message });
  }
}
