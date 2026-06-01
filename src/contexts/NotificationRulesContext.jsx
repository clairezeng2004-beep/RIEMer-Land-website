// 通知规则 Context —— 负责规则的 CRUD、云端/本地存储、与规则引擎同步
// ---------------------------------------------------------------
// 存储策略：
//   - 优先 Supabase 表 notification_rules（见 supabase-notification-rules.sql）
//   - Supabase 不可用（未配置 / 未建表 / 网络失败）时，降级 localStorage
//   - 首次使用且无任何规则时，用 DEFAULT_RULES 做种子数据，保证"老的通知
//     行为"开箱即用，不会因为新功能上线而静默消失。
// ---------------------------------------------------------------
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useNotifications } from './NotificationContext';
import {
  registerRuleEngine,
} from '../lib/notificationRuleEngine';
import { describeRule } from '../lib/notificationRuleDSL';

const STORAGE_KEY = 'riemer_notification_rules';
const RulesContext = createContext(null);

// 生成一个不依赖 crypto 的短 id（localStorage 场景足够）
function makeId() {
  return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// 种子数据：和 NotificationManagement 旧版 TRIGGER_RULES 对齐
// ——这样升级到新版不会让任何一个旧通知"消失"。
const DEFAULT_RULES = [
  {
    event: 'doc.upload',
    title: '新内部分享',
    messageTemplate: '{operator} 上传了文档「{title}」（{typeLabel}）',
    type: 'sharing',
    audience: 'operator_exclude',
    autoReadForOperator: true,
  },
  {
    event: 'doc.delete',
    title: '文档已删除',
    messageTemplate: '{operator} 删除了文档「{title}」（{typeLabel}）',
    type: 'other',
    audience: 'operator_exclude',
    autoReadForOperator: true,
  },
  {
    event: 'suggestion.new',
    title: '新建设建议',
    messageTemplate: '{operator} 提出了建议：{summary}',
    type: 'progress',
    audience: 'operator_exclude',
    autoReadForOperator: true,
  },
  {
    event: 'suggestion.status_change',
    title: '建设建议状态变更',
    messageTemplate: '建议「{summary}」状态：{from} → {to}',
    type: 'progress',
    audience: 'operator_exclude',
    autoReadForOperator: true,
  },
  {
    event: 'task.new',
    title: '新事项创建',
    messageTemplate: '{operator} 新建了事项「{title}」（{category}）',
    type: 'progress',
    audience: 'operator_exclude',
    autoReadForOperator: true,
  },
  {
    event: 'task.status_change',
    title: '事项状态变更',
    messageTemplate: '{operator} 将事项「{title}」状态：{from} → {to}',
    type: 'progress',
    audience: 'operator_exclude',
    autoReadForOperator: true,
  },
  {
    event: 'sharing.new',
    title: '新成员分享',
    messageTemplate: '{operator} 发布了新分享「{title}」（{categoryLabel}）',
    type: 'sharing',
    audience: 'operator_exclude',
    autoReadForOperator: true,
  },
  {
    event: 'article.archive',
    title: '公众号文章归档',
    messageTemplate: '{operator} 归档了公众号文章「{title}」（{category}）',
    type: 'sharing',
    audience: 'operator_exclude',
    autoReadForOperator: true,
  },
  {
    event: 'gallery.upload',
    title: '相册新增照片',
    messageTemplate: '{operator} 向相册「{albumTitle}」上传了 {count} 张照片',
    type: 'sharing',
    audience: 'operator_exclude',
    autoReadForOperator: true,
  },
];

function withDefaults(seed) {
  return seed.map((r) => ({
    id: makeId(),
    enabled: true,
    conditions: [],
    throttle: { maxPerDay: 0 },
    ...r,
    description: describeRule({ enabled: true, conditions: [], throttle: { maxPerDay: 0 }, ...r }),
  }));
}

function mergeMissingDefaults(existing) {
  const rules = Array.isArray(existing) ? existing : [];
  const existingEvents = new Set(rules.map((r) => r.event));
  const missing = DEFAULT_RULES.filter((r) => !existingEvents.has(r.event));
  if (missing.length === 0) return { rules, missing: [] };
  const seededMissing = withDefaults(missing);
  return { rules: [...rules, ...seededMissing], missing: seededMissing };
}

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return null;
}

function writeLocal(rules) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch { /* ignore */ }
}

export function NotificationRulesProvider({ children }) {
  const { user, supabaseOk } = useAuth();
  const { addNotification } = useNotifications();
  const [rules, setRules] = useState(() => readLocal() || withDefaults(DEFAULT_RULES));
  const [loading, setLoading] = useState(true);
  const [cloudAvailable, setCloudAvailable] = useState(false); // 表是否存在 & 可读

  // 是否尝试云端
  const useCloud = isSupabaseConfigured && supabaseOk !== false;

  // ---- 加载规则 ----
  const loadRules = useCallback(async () => {
    setLoading(true);
    if (useCloud) {
      try {
        const { data, error } = await supabase
          .from('notification_rules')
          .select('*')
          .order('created_at', { ascending: true });
        if (error) {
          // 常见错误：表不存在（42P01）——静默降级本地
          if (!/42P01|relation .* does not exist/i.test(error.message || '')) {
            console.warn('[NotifRules] 云端加载失败，降级本地:', error.message);
          }
          setCloudAvailable(false);
          const local = readLocal();
          if (local && local.length > 0) setRules(local);
          else {
            const seeded = withDefaults(DEFAULT_RULES);
            setRules(seeded);
            writeLocal(seeded);
          }
          return;
        }
        setCloudAvailable(true);
        if (!data || data.length === 0) {
          // 云端表存在但为空 —— 写入默认种子
          const seeded = withDefaults(DEFAULT_RULES);
          try {
            await supabase.from('notification_rules').insert(
              seeded.map((r) => ({
                id: r.id,
                event: r.event,
                title: r.title,
                message_template: r.messageTemplate,
                type: r.type,
                audience: r.audience,
                auto_read_for_operator: r.autoReadForOperator,
                conditions: r.conditions,
                throttle: r.throttle,
                enabled: r.enabled,
                description: r.description,
              }))
            );
          } catch { /* 插入失败就只用内存的即可 */ }
          setRules(seeded);
          writeLocal(seeded);
        } else {
          // 云端 → 前端字段映射
          const mapped = data.map((r) => ({
            id: r.id,
            event: r.event,
            title: r.title,
            messageTemplate: r.message_template,
            type: r.type,
            audience: r.audience,
            autoReadForOperator: r.auto_read_for_operator,
            conditions: r.conditions || [],
            throttle: r.throttle || { maxPerDay: 0 },
            enabled: r.enabled !== false,
            description: r.description || '',
          }));
          const merged = mergeMissingDefaults(mapped);
          setRules(merged.rules);
          writeLocal(merged.rules);
          if (merged.missing.length > 0) {
            try {
              await supabase.from('notification_rules').insert(
                merged.missing.map((r) => ({
                  id: r.id,
                  event: r.event,
                  title: r.title,
                  message_template: r.messageTemplate,
                  type: r.type,
                  audience: r.audience,
                  auto_read_for_operator: r.autoReadForOperator,
                  conditions: r.conditions,
                  throttle: r.throttle,
                  enabled: r.enabled,
                  description: r.description,
                }))
              );
            } catch { /* 只影响默认规则补齐，不阻塞现有规则使用 */ }
          }
        }
      } catch (err) {
        console.warn('[NotifRules] 云端加载异常，降级本地:', err?.message || err);
        setCloudAvailable(false);
        const local = readLocal();
        if (local && local.length > 0) {
          const merged = mergeMissingDefaults(local);
          setRules(merged.rules);
          writeLocal(merged.rules);
        }
      }
    } else {
      setCloudAvailable(false);
      const local = readLocal();
      if (local && local.length > 0) {
        const merged = mergeMissingDefaults(local);
        setRules(merged.rules);
        writeLocal(merged.rules);
      }
      else {
        const seeded = withDefaults(DEFAULT_RULES);
        setRules(seeded);
        writeLocal(seeded);
      }
    }
    setLoading(false);
  }, [useCloud]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // ---- 同步到规则引擎（让 emitNotificationEvent 拿到最新规则）----
  useEffect(() => {
    registerRuleEngine({
      rules,
      addNotification,
      currentUser: user,
    });
  }, [rules, addNotification, user]);

  // ---- 单条保存 ----
  const persistRule = async (rule) => {
    if (useCloud && cloudAvailable) {
      try {
        const row = {
          id: rule.id,
          event: rule.event,
          title: rule.title,
          message_template: rule.messageTemplate,
          type: rule.type,
          audience: rule.audience,
          auto_read_for_operator: rule.autoReadForOperator,
          conditions: rule.conditions,
          throttle: rule.throttle,
          enabled: rule.enabled,
          description: rule.description,
        };
        await supabase
          .from('notification_rules')
          .upsert(row, { onConflict: 'id' });
      } catch (err) {
        console.warn('[NotifRules] 云端 upsert 失败，仅保留本地:', err?.message || err);
      }
    }
  };

  // ---- 新建规则 ----
  const addRule = useCallback(async (rule) => {
    const id = rule.id || makeId();
    const toSave = {
      ...rule,
      id,
      description: describeRule(rule),
    };
    setRules((prev) => {
      const next = [...prev, toSave];
      writeLocal(next);
      return next;
    });
    await persistRule(toSave);
    return toSave;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCloud, cloudAvailable]);

  // ---- 更新规则 ----
  const updateRule = useCallback(async (rule) => {
    const toSave = { ...rule, description: describeRule(rule) };
    setRules((prev) => {
      const next = prev.map((r) => (r.id === toSave.id ? toSave : r));
      writeLocal(next);
      return next;
    });
    await persistRule(toSave);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCloud, cloudAvailable]);

  // ---- 删除 ----
  const deleteRule = useCallback(async (id) => {
    setRules((prev) => {
      const next = prev.filter((r) => r.id !== id);
      writeLocal(next);
      return next;
    });
    if (useCloud && cloudAvailable) {
      try {
        await supabase.from('notification_rules').delete().eq('id', id);
      } catch (err) {
        console.warn('[NotifRules] 云端删除失败:', err?.message || err);
      }
    }
  }, [useCloud, cloudAvailable]);

  // ---- 启用/停用 ----
  const toggleRule = useCallback(async (id) => {
    let target = null;
    setRules((prev) => {
      const next = prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, enabled: !r.enabled };
        target = updated;
        return updated;
      });
      writeLocal(next);
      return next;
    });
    if (target) await persistRule(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCloud, cloudAvailable]);

  // ---- 恢复默认 ----
  const resetToDefaults = useCallback(async () => {
    const seeded = withDefaults(DEFAULT_RULES);
    setRules(seeded);
    writeLocal(seeded);
    if (useCloud && cloudAvailable) {
      try {
        await supabase.from('notification_rules').delete().neq('id', ''); // 清空
        await supabase.from('notification_rules').insert(
          seeded.map((r) => ({
            id: r.id,
            event: r.event,
            title: r.title,
            message_template: r.messageTemplate,
            type: r.type,
            audience: r.audience,
            auto_read_for_operator: r.autoReadForOperator,
            conditions: r.conditions,
            throttle: r.throttle,
            enabled: r.enabled,
            description: r.description,
          }))
        );
      } catch (err) {
        console.warn('[NotifRules] 恢复默认云端同步失败:', err?.message || err);
      }
    }
  }, [useCloud, cloudAvailable]);

  const value = useMemo(
    () => ({
      rules,
      loading,
      cloudAvailable,
      addRule,
      updateRule,
      deleteRule,
      toggleRule,
      resetToDefaults,
      refresh: loadRules,
    }),
    [rules, loading, cloudAvailable, addRule, updateRule, deleteRule, toggleRule, resetToDefaults, loadRules]
  );

  return <RulesContext.Provider value={value}>{children}</RulesContext.Provider>;
}

export function useNotificationRules() {
  const ctx = useContext(RulesContext);
  if (!ctx) {
    throw new Error('useNotificationRules must be used within NotificationRulesProvider');
  }
  return ctx;
}
