// ============================================
// Vercel Serverless Function: 管理员辅助登录
// ============================================
// 路径: POST /api/admin-login
//
// 当 signInWithPassword 因为 "Email not confirmed" 失败时，
// 此 API 采用 Admin generateLink(magiclink) + verifyOtp 方案：
//   1. 先验证密码是否正确（Admin API 查用户 + GoTrue token 端点）
//   2. 用 Admin API 生成 magic link（不发邮件）
//   3. 直接用 hashed_token 调 verifyOtp 获取 session
//
// 这个方案完全绕过了 email_confirmed_at 检查，
// 因为 magic link 验证流程不检查邮箱是否已确认。
//
// 环境变量:
//   VITE_SUPABASE_URL — Supabase 项目 URL
//   VITE_SUPABASE_ANON_KEY — Supabase Anon Key
//   SUPABASE_SERVICE_ROLE_KEY — Supabase Service Role Key（有 Admin 权限）
// ============================================

import { createClient } from '@supabase/supabase-js';

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
    console.error('[admin-login] 环境变量缺失:', {
      url: !!supabaseUrl,
      serviceKey: !!supabaseServiceKey,
      anonKey: !!supabaseAnonKey,
    });
    return res.status(500).json({ error: 'Supabase 配置缺失' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // ========== 第1步：验证密码是否正确 ==========
    // 直接调用 GoTrue token 端点验证密码
    // 如果密码错误，会返回 "Invalid login credentials"
    // 如果密码正确但邮箱未确认，会返回 "Email not confirmed"
    console.log('[admin-login] 验证密码...');

    const passwordCheckRes = await fetch(
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

    if (passwordCheckRes.ok) {
      // 密码正确且邮箱已确认 → 直接返回 session（不应该走到这里，但以防万一）
      const session = await passwordCheckRes.json();
      console.log('[admin-login] 密码验证成功且邮箱已确认，直接返回 session');
      return res.status(200).json({ success: true, session });
    }

    const passwordErr = await passwordCheckRes.json().catch(() => ({}));
    const errMsg = passwordErr.error_description || passwordErr.msg || '';
    console.log('[admin-login] 密码验证结果:', passwordCheckRes.status, errMsg);

    // 如果不是 "Email not confirmed" 错误，说明密码不对或其他问题
    if (errMsg !== 'Email not confirmed') {
      console.error('[admin-login] 非邮箱未确认错误，拒绝登录:', errMsg);
      return res.status(401).json({
        error: errMsg === 'Invalid login credentials' ? '邮箱或密码错误' : (errMsg || '登录失败'),
      });
    }

    // ========== 第2步：密码正确但邮箱未确认 → 用 Admin generateLink 方案 ==========
    console.log('[admin-login] 密码正确但邮箱未确认，使用 Admin generateLink 方案...');

    // 创建 Admin Supabase 客户端
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 创建 Anon Supabase 客户端（用于 verifyOtp）
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 第2a步：Admin API 生成 magic link（不会发送邮件，仅生成 token）
    console.log('[admin-login] 生成 magic link...');
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: normalizedEmail,
    });

    if (linkError) {
      console.error('[admin-login] generateLink 失败:', linkError.message);
      return res.status(500).json({ error: '登录服务异常，请稍后重试' });
    }

    const hashedToken = linkData?.properties?.hashed_token;
    if (!hashedToken) {
      console.error('[admin-login] generateLink 返回数据异常，无 hashed_token:', JSON.stringify(linkData?.properties));
      return res.status(500).json({ error: '登录服务异常，请稍后重试' });
    }

    console.log('[admin-login] magic link 生成成功，验证 token...');

    // 第2b步：用 hashed_token 调 verifyOtp 获取 session
    const { data: verifyData, error: verifyError } = await supabaseAnon.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'email',
    });

    if (verifyError) {
      console.error('[admin-login] verifyOtp 失败:', verifyError.message);

      // 如果 verifyOtp 也失败了，最后尝试：先用 Admin API 确认邮箱再用密码登录
      console.log('[admin-login] verifyOtp 失败，尝试先确认邮箱再密码登录...');
      const { error: confirmError } = await supabaseAdmin.auth.admin.updateUserById(
        linkData.user?.id || '',
        { email_confirm: true }
      );

      if (confirmError) {
        console.error('[admin-login] 确认邮箱失败:', confirmError.message);
        return res.status(500).json({ error: '邮箱确认失败，请联系管理员' });
      }

      // 等待状态同步
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 重试密码登录
      const retryRes = await fetch(
        `${supabaseUrl}/auth/v1/token?grant_type=password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
          },
          body: JSON.stringify({ email: normalizedEmail, password }),
        }
      );

      if (retryRes.ok) {
        const session = await retryRes.json();
        console.log('[admin-login] 确认邮箱后密码登录成功');
        return res.status(200).json({ success: true, session });
      }

      const retryErr = await retryRes.json().catch(() => ({}));
      console.error('[admin-login] 最终登录仍失败:', retryRes.status, retryErr);
      return res.status(500).json({ error: '登录失败，请联系管理员' });
    }

    // verifyOtp 成功！
    const session = verifyData?.session;
    if (!session || !session.access_token) {
      console.error('[admin-login] verifyOtp 成功但无有效 session:', JSON.stringify(verifyData));
      return res.status(500).json({ error: '登录异常，请重试' });
    }

    console.log('[admin-login] 登录成功！用户:', session.user?.id);

    // 顺便用 Admin API 确认邮箱（后台修正，以后就不需要走这个流程了）
    if (session.user?.id) {
      supabaseAdmin.auth.admin.updateUserById(session.user.id, { email_confirm: true })
        .then(() => console.log('[admin-login] 后台邮箱确认完成'))
        .catch(err => console.warn('[admin-login] 后台邮箱确认失败:', err.message));
    }

    return res.status(200).json({
      success: true,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        expires_at: session.expires_at,
        token_type: session.token_type,
        user: session.user,
      },
    });
  } catch (err) {
    console.error('[admin-login] 异常:', err);
    return res.status(500).json({ error: '服务异常：' + err.message });
  }
}
