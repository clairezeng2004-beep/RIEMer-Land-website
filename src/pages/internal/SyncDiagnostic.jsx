// ============================================
// 同步诊断面板
// ============================================
// 用途：在任意设备上打开，一键诊断"流程模板 / 公众号文章 跨设备同步"链路的每一层
// 入口：/internal/sync-diagnostic （侧边栏"管理"分组，仅管理员可见）
//
// 检查项：
// 1. Supabase 环境变量是否已注入
// 2. Supabase REST 是否可达（HEAD /rest/v1/）
// 3. 当前是否 Supabase 已登录（auth.uid 决定 RLS 能否通过）
// 4. 各业务表可读性：documents / articles / documents_deleted_defaults / document_views
// 5. Realtime 订阅实测：建立 channel 看是否能 SUBSCRIBED
// 6. 云端行数 vs 本地缓存行数对比（能直接看出"两台设备看到不一样"根因是啥）
// 7. 可选"写入探针"：写一条临时记录→立刻删，验证 INSERT RLS 是否放行
//
// 建议使用方式：
// - A 设备打开 → 点"一键诊断" → 截图
// - B 设备打开 → 点"一键诊断" → 截图
// - 两张截图对比，哪一格变红就是问题所在

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  supabase,
  isSupabaseConfigured,
  checkSupabaseHealth,
  getReachable,
} from '../../lib/supabase';
import {
  loadLocalDocs,
  loadLocalDeletedIds,
  loadLocalViews,
} from '../../lib/documentsService';
import { CheckCircle2, XCircle, AlertCircle, Loader2, RefreshCw, Beaker, Copy } from 'lucide-react';
import './SyncDiagnostic.css';

const LOCAL_ARTICLES_KEY = 'riemer_user_articles';

/** 给任意 Promise 加超时保护：timeoutMs 后自动 reject，避免单项卡死拖累整体 */
function withTimeout(promise, timeoutMs, label = '操作') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} 超时（> ${timeoutMs / 1000}s）`)),
      timeoutMs
    );
    promise.then(
      (val) => { clearTimeout(t); resolve(val); },
      (err) => { clearTimeout(t); reject(err); }
    );
  });
}

/** 统一的"查某张表行数"逻辑：优先 estimated（O(1)），失败回退 exact */
async function countTable(tableName, timeoutMs = 8000) {
  // 先尝试 estimated（从查询计划读估算值，速度最快）
  try {
    const res = await withTimeout(
      supabase.from(tableName).select('*', { count: 'estimated', head: true }),
      timeoutMs,
      `${tableName} 计数`
    );
    if (!res.error) return { count: res.count ?? 0, error: null };
    // estimated 不支持则回退（部分旧版 PostgREST）
  } catch (err) {
    if (!/超时/.test(err.message)) {
      // 非超时错误，直接返回
      return { count: null, error: err };
    }
    // 超时就不再回退，直接报超时
    return { count: null, error: err };
  }
  // 回退 exact（兼容老 PostgREST）
  try {
    const res = await withTimeout(
      supabase.from(tableName).select('*', { count: 'exact', head: true }),
      timeoutMs,
      `${tableName} 计数`
    );
    return { count: res.count ?? 0, error: res.error || null };
  } catch (err) {
    return { count: null, error: err };
  }
}

/** 状态标签 */
function StatusBadge({ status }) {
  // status: 'ok' | 'fail' | 'warn' | 'pending' | 'idle'
  if (status === 'ok') return <CheckCircle2 size={18} className="sd-icon sd-icon--ok" />;
  if (status === 'fail') return <XCircle size={18} className="sd-icon sd-icon--fail" />;
  if (status === 'warn') return <AlertCircle size={18} className="sd-icon sd-icon--warn" />;
  if (status === 'pending') return <Loader2 size={18} className="sd-icon sd-icon--pending" />;
  return <span className="sd-icon-idle">—</span>;
}

function Row({ title, status, detail, note }) {
  return (
    <div className={`sd-row sd-row--${status || 'idle'}`}>
      <div className="sd-row__icon"><StatusBadge status={status} /></div>
      <div className="sd-row__body">
        <div className="sd-row__title">{title}</div>
        {detail && <div className="sd-row__detail">{detail}</div>}
        {note && <div className="sd-row__note">{note}</div>}
      </div>
    </div>
  );
}

export default function SyncDiagnostic() {
  const { user, isAdmin } = useAuth();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [writeProbeRunning, setWriteProbeRunning] = useState(false);
  const [writeProbeResult, setWriteProbeResult] = useState(null);
  const [realtimeEvents, setRealtimeEvents] = useState([]);
  const realtimeChannelRef = useRef(null);

  /** 运行全量诊断 */
  const runDiagnostic = useCallback(async () => {
    setRunning(true);
    setResults(null);
    setWriteProbeResult(null);
    setRealtimeEvents([]);

    const r = {
      timestamp: new Date().toISOString(),
      device: navigator.userAgent,
      // 1. 环境变量
      envConfigured: { status: 'pending', detail: '', note: '' },
      // 2. Supabase 可达性
      reachable: { status: 'pending', detail: '', note: '' },
      // 3. 当前登录态
      auth: { status: 'pending', detail: '', note: '', uid: null, email: null },
      // 4. 各表可读
      documents: { status: 'pending', detail: '', note: '', cloudCount: null, localCount: null },
      articles: { status: 'pending', detail: '', note: '', cloudCount: null, localCount: null },
      deletedDefaults: { status: 'pending', detail: '', note: '', cloudCount: null, localCount: null },
      documentViews: { status: 'pending', detail: '', note: '', cloudCount: null, localCount: null },
      // 5. Realtime 订阅
      realtime: { status: 'pending', detail: '', note: '' },
    };
    setResults({ ...r });

    // ---- 1. 环境变量 ----
    if (isSupabaseConfigured) {
      const url = import.meta.env.VITE_SUPABASE_URL || '';
      // 只展示域名前半，不泄漏完整 key
      const masked = url.replace(/^https?:\/\//, '').split('.')[0];
      r.envConfigured = {
        status: 'ok',
        detail: `已配置（Project: ${masked}…）`,
        note: '',
      };
    } else {
      r.envConfigured = {
        status: 'fail',
        detail: '未配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY',
        note: 'Vercel → Settings → Environment Variables，勾上 Production 后 Redeploy',
      };
    }
    setResults({ ...r });

    if (!isSupabaseConfigured) {
      // 环境变量都没 → 后面都不用测了
      r.reachable.status = 'fail';
      r.reachable.detail = 'Supabase 未配置，跳过所有后续检查';
      r.auth.status = 'idle';
      r.documents.status = 'idle';
      r.articles.status = 'idle';
      r.deletedDefaults.status = 'idle';
      r.documentViews.status = 'idle';
      r.realtime.status = 'idle';
      setResults({ ...r });
      setRunning(false);
      return;
    }

    // ---- 2. 可达性 ----
    const reachableOk = await checkSupabaseHealth();
    if (reachableOk) {
      r.reachable = { status: 'ok', detail: '/rest/v1/ HEAD 成功', note: '' };
    } else {
      r.reachable = {
        status: 'fail',
        detail: '/rest/v1/ HEAD 失败（超时或拒绝）',
        note: '网络/防火墙问题，或 Supabase 项目被暂停',
      };
    }
    setResults({ ...r });

    // ---- 3. 登录态 ----
    try {
      const { data: { session }, error } = await withTimeout(
        supabase.auth.getSession(),
        6000,
        'getSession'
      );
      if (error) {
        r.auth = {
          status: 'fail',
          detail: `getSession 错误：${error.message}`,
          note: '',
          uid: null,
          email: null,
        };
      } else if (!session?.user) {
        r.auth = {
          status: 'warn',
          detail: '未登录 Supabase（session 为空）',
          note: '所有 RLS 保护的表写入会被拒绝。请在"/login"页面重新登录，确认有效 session。',
          uid: null,
          email: null,
        };
      } else {
        r.auth = {
          status: 'ok',
          detail: `已登录：${session.user.email}`,
          note: `uid: ${session.user.id}`,
          uid: session.user.id,
          email: session.user.email,
        };
      }
    } catch (err) {
      r.auth = {
        status: 'fail',
        detail: `getSession 抛异常：${err.message}`,
        note: /超时/.test(err.message)
          ? 'auth 接口未响应。多半是浏览器扩展拦截了 supabase.co 的请求，或 token refresh 卡死。试试：1) 关掉广告拦截/代理 2) 清除站点 localStorage 后重登'
          : '',
        uid: null,
        email: null,
      };
    }
    setResults({ ...r });

    // ---- 4. 四张表可读性（并行，每张独立 8s 超时） ----
    // 读本地缓存（同步，秒完成）
    r.documents.localCount = loadLocalDocs().length;
    const localArticles = (() => {
      try { return JSON.parse(localStorage.getItem(LOCAL_ARTICLES_KEY) || '[]'); }
      catch { return []; }
    })();
    r.articles.localCount = localArticles.length;
    r.deletedDefaults.localCount = loadLocalDeletedIds().length;
    r.documentViews.localCount = Object.keys(loadLocalViews()).length;
    setResults({ ...r });

    // 并行查 4 张表
    const [docRes, artRes, delRes, viewRes] = await Promise.all([
      countTable('documents'),
      countTable('articles'),
      countTable('documents_deleted_defaults'),
      countTable('document_views'),
    ]);

    // ---- 4a. documents ----
    {
      const { count, error } = docRes;
      if (error) {
        r.documents = {
          ...r.documents,
          status: 'fail',
          detail: `读取失败：${error.message} (${error.code || ''})`,
          note: /超时/.test(error.message)
            ? '查询超时（> 8s）。RLS 策略过于复杂或网络抖动。去 Supabase 检查 documents 表的 RLS policy 是否含昂贵子查询。'
            : error.code === '42P01'
              ? '表不存在 → 重新执行 supabase-setup.sql'
              : error.code === 'PGRST301' || error.message?.includes('permission')
                ? 'RLS 策略拒绝 → 检查 Supabase 控制台 documents 表的 Policies'
                : '',
          cloudCount: null,
        };
      } else {
        const cloud = count ?? 0;
        const local = r.documents.localCount;
        let status = 'ok';
        let note = '';
        if (cloud === 0 && local > 0) {
          status = 'warn';
          note = `本地有 ${local} 条但云端 0 条 — 说明之前的写入没落到云端（多半是登录/RLS 问题）`;
        } else if (Math.abs(cloud - local) > 0) {
          status = 'ok';
          note = cloud > local ? '云端比本地多（正常，其他设备有写入）' : '本地比云端多（可能离线时写了本地）';
        }
        r.documents = {
          ...r.documents,
          status,
          detail: `云端：${cloud} 条 · 本地缓存：${local} 条`,
          note,
          cloudCount: cloud,
        };
      }
    }

    // ---- 4b. articles ----
    {
      const { count, error } = artRes;
      if (error) {
        r.articles = {
          ...r.articles,
          status: 'fail',
          detail: `读取失败：${error.message} (${error.code || ''})`,
          note: /超时/.test(error.message)
            ? '查询超时（> 8s）。检查 articles 表 RLS 策略或网络。'
            : error.code === '42P01'
              ? '表不存在 → 重新执行 supabase-setup.sql'
              : error.code === 'PGRST301' || error.message?.includes('permission')
                ? 'RLS 策略拒绝 → 检查 Supabase 控制台 articles 表的 Policies'
                : '',
          cloudCount: null,
        };
      } else {
        const cloud = count ?? 0;
        const local = r.articles.localCount;
        let status = 'ok';
        let note = '';
        if (cloud === 0 && local > 0) {
          status = 'warn';
          note = `本地有 ${local} 条但云端 0 条 — 说明之前的归档只存了本地，没写入云端`;
        } else if (Math.abs(cloud - local) > 0) {
          note = cloud > local ? '云端比本地多（正常）' : '本地比云端多';
        }
        r.articles = {
          ...r.articles,
          status,
          detail: `云端：${cloud} 条 · 本地缓存：${local} 条`,
          note,
          cloudCount: cloud,
        };
      }
    }

    // ---- 4c. documents_deleted_defaults ----
    {
      const { count, error } = delRes;
      if (error) {
        r.deletedDefaults = {
          ...r.deletedDefaults,
          status: error.code === '42P01' ? 'fail' : 'warn',
          detail: `读取失败：${error.message}`,
          note: error.code === '42P01'
            ? '该表不存在（不影响主流程，删除默认模板数据才需要）'
            : /超时/.test(error.message) ? '查询超时，可忽略' : '',
        };
      } else {
        r.deletedDefaults = {
          ...r.deletedDefaults,
          status: 'ok',
          detail: `云端：${count ?? 0} 条 · 本地缓存：${r.deletedDefaults.localCount} 条`,
          note: '',
          cloudCount: count ?? 0,
        };
      }
    }

    // ---- 4d. document_views ----
    {
      const { count, error } = viewRes;
      if (error) {
        r.documentViews = {
          ...r.documentViews,
          status: error.code === '42P01' ? 'fail' : 'warn',
          detail: `读取失败：${error.message}`,
          note: error.code === '42P01'
            ? '该表不存在（浏览计数跨设备同步不可用）'
            : /超时/.test(error.message) ? '查询超时，可忽略' : '',
        };
      } else {
        r.documentViews = {
          ...r.documentViews,
          status: 'ok',
          detail: `云端：${count ?? 0} 条 · 本地缓存：${r.documentViews.localCount} 条`,
          note: '',
          cloudCount: count ?? 0,
        };
      }
    }

    setResults({ ...r });

    // ---- 5. Realtime 订阅实测 ----
    // 断掉之前的订阅
    if (realtimeChannelRef.current) {
      try { supabase.removeChannel(realtimeChannelRef.current); } catch { /* ignore */ }
      realtimeChannelRef.current = null;
    }
    r.realtime = { status: 'pending', detail: '订阅建立中...', note: '' };
    setResults({ ...r });

    await new Promise((resolve) => {
      let settled = false;
      const ch = supabase
        .channel('diagnostic_probe_' + Date.now())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, (payload) => {
          setRealtimeEvents((prev) => [
            { time: new Date().toLocaleTimeString(), type: payload.eventType || payload.type, table: 'documents' },
            ...prev.slice(0, 9),
          ]);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'articles' }, (payload) => {
          setRealtimeEvents((prev) => [
            { time: new Date().toLocaleTimeString(), type: payload.eventType || payload.type, table: 'articles' },
            ...prev.slice(0, 9),
          ]);
        })
        .subscribe((status) => {
          if (settled) return;
          if (status === 'SUBSCRIBED') {
            settled = true;
            r.realtime = {
              status: 'ok',
              detail: '订阅已建立（SUBSCRIBED）',
              note: '下方"实时事件"区会捕获其他设备的新增/更新/删除',
            };
            setResults({ ...r });
            realtimeChannelRef.current = ch;
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            settled = true;
            r.realtime = {
              status: 'fail',
              detail: `订阅失败：${status}`,
              note: '很可能是：1) Publication 未启用（supabase-setup.sql 最后 ALTER PUBLICATION 没跑）；2) Realtime 被网络防火墙阻挡（WebSocket 不通）',
            };
            setResults({ ...r });
            try { supabase.removeChannel(ch); } catch { /* ignore */ }
            resolve();
          }
        });

      // 6 秒仍未 SUBSCRIBED → 算超时
      setTimeout(() => {
        if (!settled) {
          settled = true;
          r.realtime = {
            status: 'fail',
            detail: '订阅建立超时（> 6s）',
            note: 'WebSocket 连不上（/realtime/v1/websocket）。检查网络是否拦截 WSS、或 Supabase 项目 Realtime 是否启用。',
          };
          setResults({ ...r });
          try { supabase.removeChannel(ch); } catch { /* ignore */ }
          resolve();
        }
      }, 6000);
    });

    setRunning(false);
  }, []);

  /** 写入探针：insert 一条临时 document → delete，验证 INSERT RLS 是否通过 */
  const runWriteProbe = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setWriteProbeRunning(true);
    setWriteProbeResult(null);

    const probeId = 'doc-probe-' + Date.now();
    const probeRow = {
      id: probeId,
      title: '__诊断探针，可安全忽略__',
      type: 'process',
      description: '',
      format: 'word',
      content: '',
      attachments: [],
      file_type: null,
      file_url: null,
      size_text: '—',
      uploaded_by: user?.name || 'Diagnostic',
      uploaded_by_id: user?.id || null,
      date: new Date().toISOString().split('T')[0],
      view_count: 0,
      likes: [],
    };

    const steps = [];

    // INSERT
    try {
      const { error: insErr } = await supabase.from('documents').insert(probeRow);
      if (insErr) {
        steps.push({ step: 'INSERT documents', ok: false, msg: `${insErr.message} (${insErr.code || ''})` });
        setWriteProbeResult({
          ok: false,
          summary: '写入失败 — RLS 拒绝或表结构不匹配',
          hint: insErr.code === '42501'
            ? '权限不足（RLS INSERT 策略要求 authenticated，当前未登录 Supabase）'
            : insErr.code === '42P01'
              ? 'documents 表不存在，请重新执行 supabase-setup.sql'
              : '检查 Supabase 控制台的 Policies + 当前登录态',
          steps,
        });
        setWriteProbeRunning(false);
        return;
      }
      steps.push({ step: 'INSERT documents', ok: true, msg: '插入成功' });
    } catch (err) {
      steps.push({ step: 'INSERT documents', ok: false, msg: err.message });
      setWriteProbeResult({ ok: false, summary: '写入异常', hint: err.message, steps });
      setWriteProbeRunning(false);
      return;
    }

    // SELECT 回读
    try {
      const { data, error: selErr } = await supabase
        .from('documents').select('id,title').eq('id', probeId).maybeSingle();
      if (selErr) {
        steps.push({ step: 'SELECT 回读', ok: false, msg: selErr.message });
      } else if (data) {
        steps.push({ step: 'SELECT 回读', ok: true, msg: `回读到探针记录（id=${data.id}）` });
      } else {
        steps.push({ step: 'SELECT 回读', ok: false, msg: '未回读到刚插入的记录（RLS SELECT 策略可能不允许）' });
      }
    } catch (err) {
      steps.push({ step: 'SELECT 回读', ok: false, msg: err.message });
    }

    // DELETE 清理
    try {
      const { error: delErr } = await supabase.from('documents').delete().eq('id', probeId);
      if (delErr) {
        steps.push({ step: 'DELETE 清理', ok: false, msg: `${delErr.message}（请手动去 Supabase 删除 id=${probeId}）` });
      } else {
        steps.push({ step: 'DELETE 清理', ok: true, msg: '探针已删除' });
      }
    } catch (err) {
      steps.push({ step: 'DELETE 清理', ok: false, msg: err.message });
    }

    const allOk = steps.every((s) => s.ok);
    setWriteProbeResult({
      ok: allOk,
      summary: allOk
        ? '写入探针全部通过 — 说明「登录态 + RLS + 表结构」都正常'
        : '部分步骤失败 — 按下面每一步的提示排查',
      hint: '',
      steps,
    });
    setWriteProbeRunning(false);
  }, [user]);

  /** 把诊断结果复制成文本，便于粘贴给开发者 */
  const copyReport = useCallback(() => {
    if (!results) return;
    const lines = [
      '[RIEMer Land 同步诊断报告]',
      '时间: ' + results.timestamp,
      '设备: ' + results.device,
      '当前登录用户: ' + (user?.email || '未登录') + ' / role=' + (user?.role || '-'),
      '',
      '1. 环境变量: ' + results.envConfigured.status + ' — ' + results.envConfigured.detail,
      '2. 可达性  : ' + results.reachable.status + ' — ' + results.reachable.detail,
      '3. 登录态  : ' + results.auth.status + ' — ' + results.auth.detail + (results.auth.note ? ' | ' + results.auth.note : ''),
      '4a. documents              : ' + results.documents.status + ' — ' + results.documents.detail + (results.documents.note ? ' | ' + results.documents.note : ''),
      '4b. articles               : ' + results.articles.status + ' — ' + results.articles.detail + (results.articles.note ? ' | ' + results.articles.note : ''),
      '4c. documents_deleted_def. : ' + results.deletedDefaults.status + ' — ' + results.deletedDefaults.detail,
      '4d. document_views         : ' + results.documentViews.status + ' — ' + results.documentViews.detail,
      '5. Realtime订阅: ' + results.realtime.status + ' — ' + results.realtime.detail + (results.realtime.note ? ' | ' + results.realtime.note : ''),
      '',
      '写入探针: ' + (writeProbeResult ? (writeProbeResult.ok ? 'OK' : 'FAIL — ' + writeProbeResult.summary) : '未运行'),
    ];
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(
      () => alert('诊断报告已复制到剪贴板'),
      () => alert('复制失败，请手动选择文字复制')
    );
  }, [results, writeProbeResult, user]);

  // 组件卸载时移除 Realtime channel，避免泄漏
  useEffect(() => {
    return () => {
      if (realtimeChannelRef.current) {
        try { supabase.removeChannel(realtimeChannelRef.current); } catch { /* ignore */ }
      }
    };
  }, []);

  // 首次进入自动跑一次
  useEffect(() => {
    runDiagnostic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAdmin) {
    return (
      <div className="sd-container">
        <div className="sd-unauthorized">
          <AlertCircle size={24} />
          <p>此页面仅对管理员可见。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sd-container">
      <header className="sd-header">
        <div>
          <h1 className="sd-title">同步诊断</h1>
          <p className="sd-subtitle">排查"流程模板 / 公众号文章"跨设备同步链路，从上到下依次检查</p>
        </div>
        <div className="sd-actions">
          <button className="sd-btn sd-btn--primary" onClick={runDiagnostic} disabled={running}>
            <RefreshCw size={16} className={running ? 'sd-spin' : ''} />
            {running ? '诊断中...' : '重新诊断'}
          </button>
          <button className="sd-btn" onClick={copyReport} disabled={!results}>
            <Copy size={16} /> 复制报告
          </button>
        </div>
      </header>

      {/* 设备 / 登录快览 */}
      <div className="sd-summary">
        <div className="sd-summary__item">
          <span className="sd-summary__label">当前设备</span>
          <span className="sd-summary__value">
            {/iPhone|iPad|iPod/.test(navigator.userAgent) ? 'iOS' :
             /Android/.test(navigator.userAgent) ? 'Android' :
             /Macintosh/.test(navigator.userAgent) ? 'macOS' :
             /Windows/.test(navigator.userAgent) ? 'Windows' : '其他'}
          </span>
        </div>
        <div className="sd-summary__item">
          <span className="sd-summary__label">登录用户</span>
          <span className="sd-summary__value">{user?.email || '未登录'}</span>
        </div>
        <div className="sd-summary__item">
          <span className="sd-summary__label">Supabase</span>
          <span className="sd-summary__value">
            {!isSupabaseConfigured ? '未配置' : getReachable() === false ? '离线模式' : '在线'}
          </span>
        </div>
      </div>

      {/* 检查结果 */}
      {results && (
        <section className="sd-section">
          <h2 className="sd-section-title">诊断结果</h2>
          <Row
            title="1. 环境变量注入"
            status={results.envConfigured.status}
            detail={results.envConfigured.detail}
            note={results.envConfigured.note}
          />
          <Row
            title="2. Supabase 服务可达"
            status={results.reachable.status}
            detail={results.reachable.detail}
            note={results.reachable.note}
          />
          <Row
            title="3. Supabase 登录态（RLS 前置条件）"
            status={results.auth.status}
            detail={results.auth.detail}
            note={results.auth.note}
          />
          <Row
            title="4a. documents 表（流程模板）读取"
            status={results.documents.status}
            detail={results.documents.detail}
            note={results.documents.note}
          />
          <Row
            title="4b. articles 表（公众号文章归档）读取"
            status={results.articles.status}
            detail={results.articles.detail}
            note={results.articles.note}
          />
          <Row
            title="4c. documents_deleted_defaults 表"
            status={results.deletedDefaults.status}
            detail={results.deletedDefaults.detail}
            note={results.deletedDefaults.note}
          />
          <Row
            title="4d. document_views 表（浏览计数）"
            status={results.documentViews.status}
            detail={results.documentViews.detail}
            note={results.documentViews.note}
          />
          <Row
            title="5. Realtime 订阅（WebSocket 实时推送）"
            status={results.realtime.status}
            detail={results.realtime.detail}
            note={results.realtime.note}
          />
        </section>
      )}

      {/* 实时事件监听 */}
      {results?.realtime?.status === 'ok' && (
        <section className="sd-section">
          <h2 className="sd-section-title">实时事件（最近 10 条）</h2>
          <p className="sd-hint">
            保持本页不关。此时让另一台设备发布/编辑/删除一条流程模板或文章 —— 这里应该立刻出现事件。若无 = 订阅通了但事件没推送（多半是 Publication 未加表）。
          </p>
          {realtimeEvents.length === 0 ? (
            <div className="sd-empty">（暂无事件。请在另一台设备上操作试试）</div>
          ) : (
            <ul className="sd-events">
              {realtimeEvents.map((e, i) => (
                <li key={i} className="sd-events__item">
                  <span className="sd-events__time">{e.time}</span>
                  <span className="sd-events__type">{e.type}</span>
                  <span className="sd-events__table">{e.table}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 写入探针 */}
      {isSupabaseConfigured && (
        <section className="sd-section">
          <h2 className="sd-section-title">写入探针（可选）</h2>
          <p className="sd-hint">
            点击后会：插入一条「__诊断探针__」文档 → 回读 → 立即删除。全绿色表示写入链路完全 OK；
            若 INSERT 失败但上面"登录态"是绿的，说明是 RLS 策略阻拦了当前用户。
          </p>
          <button
            className="sd-btn sd-btn--secondary"
            onClick={runWriteProbe}
            disabled={writeProbeRunning}
          >
            <Beaker size={16} />
            {writeProbeRunning ? '探测中...' : '开始写入探针'}
          </button>

          {writeProbeResult && (
            <div className={`sd-probe sd-probe--${writeProbeResult.ok ? 'ok' : 'fail'}`}>
              <div className="sd-probe__summary">
                <StatusBadge status={writeProbeResult.ok ? 'ok' : 'fail'} />
                <span>{writeProbeResult.summary}</span>
              </div>
              {writeProbeResult.hint && (
                <div className="sd-probe__hint">{writeProbeResult.hint}</div>
              )}
              <ul className="sd-probe__steps">
                {writeProbeResult.steps.map((s, i) => (
                  <li key={i} className={s.ok ? 'sd-probe__step--ok' : 'sd-probe__step--fail'}>
                    <StatusBadge status={s.ok ? 'ok' : 'fail'} />
                    <span className="sd-probe__step-name">{s.step}</span>
                    <span className="sd-probe__step-msg">{s.msg}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 使用提示 */}
      <section className="sd-section sd-tips">
        <h2 className="sd-section-title">如何使用</h2>
        <ol>
          <li><b>A 设备</b>打开本页 → 等诊断跑完 → 点「复制报告」</li>
          <li><b>B 设备</b>打开本页 → 等诊断跑完 → 点「复制报告」</li>
          <li><b>两份报告对比</b>，差异点（尤其是红色/黄色）就是跨设备不同步的根因</li>
          <li>保持 A 本页不关，在 B 发布一条文章，观察"实时事件"是否出现</li>
          <li>若第 3 步"登录态"为红/黄 → 先解决登录问题；第 5 步"Realtime"为红 → 去 Supabase SQL Editor 跑 <code>ALTER PUBLICATION supabase_realtime ADD TABLE documents, articles;</code></li>
        </ol>
      </section>
    </div>
  );
}
