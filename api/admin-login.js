// ============================================
// Vercel Serverless Function: 管理员辅助登录
// ============================================
// 路径: POST /api/admin-login
// 当用户邮箱未确认（Email not confirmed）时，使用 Admin API：
//   1. 先自动确认邮箱
//   2. 然后用 signInWithPassword 登录并返回 session
//
// 这个 API 彻底解决了 Supabase Auth 要求邮箱验证但管理员已授权的矛盾。
//
// 环境变量:
//   VITE_SUPABASE_URL — Supabase 项目 URL
//   VITE_SUPABASE_ANON_KEY — Supabase Anon Key
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

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: '请提供邮箱和密码' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Supabase 配置缺失' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // ========== 第1步：通过 Admin API 查找用户 ==========
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
        console.error('[admin-login] 获取用户列表失败:', listRes.status);
        return res.status(500).json({ error: '服务端错误：获取用户列表失败' });
      }

      const { users } = await listRes.json();
      if (!users || users.length === 0) break;

      targetUser = users.find(
        (u) => u.email?.toLowerCase() === normalizedEmail
      );

      if (users.length < perPage) break;
      page++;
    }

    if (!targetUser) {
      return res.status(404).json({ error: '未找到该邮箱对应的用户' });
    }

    console.log('[admin-login] 找到用户:', targetUser.id, '邮箱确认状态:', !!targetUser.email_confirmed_at);

    // ========== 第2步：如果邮箱未确认，使用 Admin API 强制确认 ==========
    if (!targetUser.email_confirmed_at) {
      console.log('[admin-login] 邮箱未确认，正在强制确认...');
      const confirmRes = await fetch(
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

      if (!confirmRes.ok) {
        const errText = await confirmRes.text().catch(() => '');
        console.error('[admin-login] 确认邮箱失败:', confirmRes.status, errText);
        return res.status(500).json({ error: '确认邮箱失败，请联系管理员' });
      }

      console.log('[admin-login] 邮箱已强制确认');

      // 等待一小段时间让 Supabase 内部状态同步
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // ========== 第3步：使用 GoTrue token 接口登录（服务端代理） ==========
    // 使用 Supabase 的 /auth/v1/token 端点直接登录
    const tokenRes = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password: password,
        }),
      }
    );

    if (!tokenRes.ok) {
      const tokenErr = await tokenRes.json().catch(() => ({}));
      console.error('[admin-login] 登录失败:', tokenRes.status, tokenErr);

      // 如果还是 Email not confirmed，尝试直接设置 email_confirmed_at
      if (tokenErr.error_description === 'Email not confirmed' || tokenErr.msg === 'Email not confirmed') {
        console.log('[admin-login] 确认邮箱后仍报未确认，尝试直接设置 email_confirmed_at...');

        const now = new Date().toISOString();
        const retryConfirmRes = await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${targetUser.id}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              apikey: supabaseServiceKey,
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              email_confirm: true,
              user_metadata: { email_verified: true, email_confirmed_at: now },
            }),
          }
        );

        if (retryConfirmRes.ok) {
          console.log('[admin-login] 第二次确认成功，重新尝试登录...');
          await new Promise(resolve => setTimeout(resolve, 1000));

          const retryTokenRes = await fetch(
            `${supabaseUrl}/auth/v1/token?grant_type=password`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
              },
              body: JSON.stringify({
                email: normalizedEmail,
                password: password,
              }),
            }
          );

          if (retryTokenRes.ok) {
            const session = await retryTokenRes.json();
            console.log('[admin-login] 第二次登录成功');
            return res.status(200).json({
              success: true,
              session: session,
            });
          }

          const retryErr = await retryTokenRes.json().catch(() => ({}));
          console.error('[admin-login] 第二次登录也失败:', retryTokenRes.status, retryErr);

          // 最终手段：使用 Admin API 直接生成魔法链接 token
          return res.status(401).json({
            error: tokenErr.error_description || tokenErr.msg || '密码错误或邮箱确认失败',
            detail: '请确认密码是否正确',
          });
        }
      }

      return res.status(401).json({
        error: tokenErr.error_description || tokenErr.msg || '邮箱或密码错误',
      });
    }

    const session = await tokenRes.json();
    console.log('[admin-login] 登录成功，用户:', session.user?.id);

    return res.status(200).json({
      success: true,
      session: session,
    });
  } catch (err) {
    console.error('[admin-login] 异常:', err);
    return res.status(500).json({ error: '服务异常：' + err.message });
  }
}
