import { useState } from 'react';
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
  const { internalConfig, updateInternalConfig, resetInternalConfig } = useSiteContent();
  const { editing, enterEdit, exitEdit, changedKeys } = useWysiwyg();
  const [saved, setSaved] = useState(false);

  // 仅管理员可见
  if (!isAdmin) return null;

  const handleSave = () => {
    // internalConfig 已在各页面通过 onChange 实时更新，此处只需触发持久化提示
    updateInternalConfig(internalConfig);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    exitEdit();
  };

  const handleCancel = () => {
    // 取消编辑——需要刷新页面恢复到 localStorage 的状态
    if (changedKeys.size > 0) {
      if (window.confirm('有未保存的修改，确定放弃吗？')) {
        window.location.reload();
      }
    } else {
      exitEdit();
    }
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
          onClick={enterEdit}
          title="进入所见即所得编辑模式"
        >
          <Pencil size={20} />
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
