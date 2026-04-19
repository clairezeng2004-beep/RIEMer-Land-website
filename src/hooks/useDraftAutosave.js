import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 草稿自动保存 Hook
 *
 * 功能：
 *  - 将表单数据按 key 自动保存到 localStorage（带防抖）
 *  - 提供 loadDraft / clearDraft / flush 操作
 *  - 暴露 saving / lastSavedAt / hasDraft 状态，便于 UI 展示
 *  - 离开页面（beforeunload）时强制 flush 一次
 *
 * 用法：
 *   const draft = useDraftAutosave({
 *     key: `process-template-create:${userId}`,
 *     values: newDoc,
 *     enabled: true,
 *     delay: 1500,
 *   })
 *   draft.loadDraft()        // 读取已有草稿（不自动恢复）
 *   draft.clearDraft()       // 发布/取消后清理
 *   draft.lastSavedAt        // Date | null
 *   draft.saving             // boolean
 */
export default function useDraftAutosave({
  key,
  values,
  enabled = true,
  delay = 1500,
  storage = typeof window !== 'undefined' ? window.localStorage : null,
  isEmpty,
}) {
  const storageKey = key ? `riemer_draft:${key}` : null
  const timerRef = useRef(null)
  const lastSerializedRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [hasDraft, setHasDraft] = useState(false)

  // 初次挂载时检测是否存在草稿
  useEffect(() => {
    if (!storage || !storageKey) return
    try {
      const raw = storage.getItem(storageKey)
      setHasDraft(Boolean(raw))
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (parsed?.savedAt) setLastSavedAt(new Date(parsed.savedAt))
        } catch { /* ignore */ }
      }
    } catch {
      setHasDraft(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const writeDraft = useCallback(
    (data) => {
      if (!storage || !storageKey) return
      try {
        const payload = {
          savedAt: new Date().toISOString(),
          values: data,
        }
        const serialized = JSON.stringify(payload)
        // 避免重复写入相同内容
        if (serialized === lastSerializedRef.current) return
        storage.setItem(storageKey, serialized)
        lastSerializedRef.current = serialized
        setLastSavedAt(new Date(payload.savedAt))
        setHasDraft(true)
      } catch (err) {
        // localStorage 可能因为隐私模式 / 容量问题抛错，静默降级即可
        console.warn('[useDraftAutosave] save failed:', err)
      }
    },
    [storage, storageKey]
  )

  // 判空逻辑：默认按是否有任何非空字符串/数组长度 > 0
  const defaultIsEmpty = useCallback((v) => {
    if (v == null) return true
    if (typeof v === 'string') return v.trim().length === 0
    if (Array.isArray(v)) return v.length === 0
    if (typeof v === 'object') {
      return Object.values(v).every((item) => defaultIsEmpty(item))
    }
    return false
  }, [])

  const checkEmpty = isEmpty || defaultIsEmpty

  // 防抖自动保存
  useEffect(() => {
    if (!enabled || !storage || !storageKey) return
    if (checkEmpty(values)) return

    setSaving(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      writeDraft(values)
      setSaving(false)
    }, delay)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), enabled, delay, storageKey])

  // 页面关闭前强制 flush
  useEffect(() => {
    if (!enabled || !storage || !storageKey) return
    const handler = () => {
      if (!checkEmpty(values)) writeDraft(values)
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, storageKey, values])

  const loadDraft = useCallback(() => {
    if (!storage || !storageKey) return null
    try {
      const raw = storage.getItem(storageKey)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return {
        values: parsed?.values ?? null,
        savedAt: parsed?.savedAt ? new Date(parsed.savedAt) : null,
      }
    } catch {
      return null
    }
  }, [storage, storageKey])

  const clearDraft = useCallback(() => {
    if (!storage || !storageKey) return
    try {
      storage.removeItem(storageKey)
      lastSerializedRef.current = null
      setHasDraft(false)
      setLastSavedAt(null)
    } catch { /* ignore */ }
  }, [storage, storageKey])

  const flush = useCallback(() => {
    if (!enabled || checkEmpty(values)) return
    if (timerRef.current) clearTimeout(timerRef.current)
    writeDraft(values)
    setSaving(false)
  }, [enabled, values, writeDraft, checkEmpty])

  return { saving, lastSavedAt, hasDraft, loadDraft, clearDraft, flush }
}
