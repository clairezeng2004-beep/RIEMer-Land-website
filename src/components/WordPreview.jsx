import { useState, useEffect, useRef } from 'react';
import mammoth from 'mammoth';
import { FileText, Loader, AlertCircle } from 'lucide-react';
import TextAnnotation from './TextAnnotation';
import './WordPreview.css';

/**
 * WordPreview — Word 文档在线预览组件
 *
 * 将 .docx 文件通过 mammoth.js 转为 HTML 渲染，
 * 渲染后的文本是原生 DOM，完全支持划词评论。
 *
 * Props:
 *   fileUrl: string — docx 文件的 URL
 *   docId: string — 文档 ID（用于评论关联）
 *   title: string — 文档标题
 */
export default function WordPreview({ fileUrl, docId, title }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const contentRef = useRef(null);

  useEffect(() => {
    if (!fileUrl) {
      setLoading(false);
      setError('文档尚未关联文件');
      return;
    }

    let cancelled = false;

    async function loadDocx() {
      setLoading(true);
      setError('');

      try {
        // 获取 .docx 文件的 ArrayBuffer
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`加载失败: ${response.status}`);

        const arrayBuffer = await response.arrayBuffer();

        // mammoth 转换 docx → HTML
        const result = await mammoth.convertToHtml(
          { arrayBuffer },
          {
            // 样式映射：保留文档结构
            styleMap: [
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
              "p[style-name='Title'] => h1.doc-title:fresh",
              "p[style-name='Subtitle'] => h2.doc-subtitle:fresh",
            ],
            // 图片处理：转为 base64 内嵌
            convertImage: mammoth.images.imgElement(function (image) {
              return image.read('base64').then(function (imageBuffer) {
                return {
                  src: `data:${image.contentType};base64,${imageBuffer}`,
                };
              });
            }),
          }
        );

        if (!cancelled) {
          setHtml(result.value);

          // 如果有转换警告，只在控制台输出
          if (result.messages.length > 0) {
            console.log('[WordPreview] 转换警告:', result.messages);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[WordPreview] 加载失败:', err);
          setError(err.message || '文档加载失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDocx();

    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  // 加载中
  if (loading) {
    return (
      <div className="word-preview__loading">
        <Loader size={32} className="word-preview__spinner" />
        <p>正在解析 Word 文档…</p>
      </div>
    );
  }

  // 错误
  if (error) {
    return (
      <div className="word-preview__error">
        <AlertCircle size={32} />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="word-preview">
      {/* 文档标题栏 */}
      <div className="word-preview__title-bar">
        <FileText size={16} />
        <span>{title}</span>
        <span className="word-preview__badge">Word 文档预览</span>
      </div>

      {/* Word 内容渲染区 — 支持划词 */}
      <div
        ref={contentRef}
        className="word-preview__content"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {/* 划词评论组件 — 完整划词支持 */}
      <TextAnnotation
        targetType="document"
        targetId={docId}
        contentRef={contentRef}
        disabled={false}
      />
    </div>
  );
}
