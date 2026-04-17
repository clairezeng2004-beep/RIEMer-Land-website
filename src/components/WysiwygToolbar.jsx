import { useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSiteContent } from '../contexts/SiteContentContext';
import { useWysiwyg } from '../contexts/WysiwygContext';
import {
  Pencil,
  Save,
  X,
  RotateCcw,
  CheckCircle,
  Eye,
} from 'lucide-react';
import './WysiwygToolbar.css';

export default function WysiwygToolbar() {
  const { isAdmin } = useAuth();
  const {
    internalConfig,
    replaceInternalConfig,
    flushInternalConfig,
    setInternalConfigPersistPaused,
    resetInternalConfig,
  } = useSiteContent();
  const { editing, enterEdit, saveEdit, cancelEdit, changedKeys } = useWysiwyg();
  const [saved, setSaved] = useState(false);

  // 进入编辑模式时，快照当前 internalConfig，用于"取消"时回滚
  const snapshotRef = useRef(null);

  // 仅管理员可见
  if (!isAdmin) return null;

  const handleEnterEdit = () => {
    // 深拷贝快照，避免引用泄漏
    snapshotRef.current = JSON.parse(JSON.stringify(internalConfig));
    // 暂停 internalConfig 自动持久化 —— 编辑期间改内存，不落盘
    setInternalConfigPersistPaused(true);
    enterEdit({
      onSave: () => {
        // 解除暂停并落盘
        flushInternalConfig();
        setInternalConfigPersistPaused(false);
        snapshotRef.current = null;
      },
      onCancel: () => {
        // 把 internalConfig 还原到进入编辑前的快照
        if (snapshotRef.current) {
          replaceInternalConfig(snapshotRef.current);
        }
        setInternalConfigPersistPaused(false);
        snapshotRef.current = null;
      },
    });
  };

  const handleSave = () => {
    saveEdit(); // 触发 onSave -> flushInternalConfig + 解除暂停
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleCancel = () => {
    if (changedKeys.size > 0) {
      if (!window.confirm('有未保存的修改，确定放弃吗？')) return;
    }
    cancelEdit(); // 触发 onCancel -> replaceInternalConfig(snapshot) + 解除暂停
  };

  const handleReset = () => {
    if (window.confirm('确定要重置所有内部空间配置为默认值吗？此操作不可撤销。')) {
      resetInternalConfig();
      window.location.reload();
    }
  };

  if (!editing) {
    return (
      <>
        <button
          className="wysiwyg-fab"
          onClick={handleEnterEdit}
          title="进入管理者编辑模式"
        >
          <Pencil size={20} />
          <span className="wysiwyg-fab__label">进入管理者编辑模式</span>
        </button>
        {saved && (
          <div className="wysiwyg-toast">
            <CheckCircle size={16} />
            <span>内部空间配置已保存</span>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="wysiwyg-toolbar">
      <div className="wysiwyg-toolbar__left">
        <Eye size={16} />
        <span className="wysiwyg-toolbar__label">所见即所得编辑模式</span>
        {changedKeys.size > 0 && (
          <span className="wysiwyg-toolbar__badge">
            {changedKeys.size} 处修改
          </span>
        )}
      </div>
      <div className="wysiwyg-toolbar__actions">
        <button
          className="wysiwyg-toolbar__btn wysiwyg-toolbar__btn--ghost"
          onClick={handleReset}
          title="重置默认"
        >
          <RotateCcw size={14} />
          <span>重置默认</span>
        </button>
        <button
          className="wysiwyg-toolbar__btn wysiwyg-toolbar__btn--ghost"
          onClick={handleCancel}
        >
          <X size={14} />
          <span>取消</span>
        </button>
        <button
          className="wysiwyg-toolbar__btn wysiwyg-toolbar__btn--primary"
          onClick={handleSave}
        >
          <Save size={14} />
          <span>保存更改</span>
        </button>
      </div>
    </div>
  );
}
