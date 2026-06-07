import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MessageCircle, X, Send, ArrowRight, Loader2, Mic, MicOff } from 'lucide-react';
import { sendMessage } from '../services/chatService';
import { useSiteContent } from '../contexts/SiteContentContext';
import ArticlePreviewModal from './ArticlePreviewModal';
import './ArticleChat.css';

// 把小 R 回复里的 **加粗** 和 [文字](链接) 渲染成真正的样式，
// 而不是把星号 / 方括号直接显示成纯文本。
function renderRichText(text) {
  if (!text) return null;
  const nodes = [];
  const regex = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let key = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    if (m[1] !== undefined) {
      nodes.push(<strong key={key++}>{m[1]}</strong>);
    } else {
      nodes.push(
        <a key={key++} href={m[3]} target="_blank" rel="noopener noreferrer">
          {m[2]}
        </a>
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

// 浏览器 SpeechRecognition 兼容处理
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// ---- 快捷指令配置 ----
const INITIAL_QUICK_ACTIONS = [
  { label: '保研经验', text: '有没有保研相关的经验分享？' },
  { label: '课程测评', text: '课程测评 选课推荐' },
  { label: '求职分享', text: '有求职或实习相关的经验分享吗？' },
  { label: '考研备考', text: '考研应该怎么准备？' },
];

// 根据最后一条 AI 回复的内容，动态生成后续快捷指令
function getContextQuickActions(lastAssistantMsg) {
  if (!lastAssistantMsg) return [];
  const text = lastAssistantMsg.toLowerCase();
  const actions = [];

  // 提到了保研/考研
  if (text.includes('保研') || text.includes('推免')) {
    actions.push({ label: '保研时间线', text: '保研准备时间线是怎样的？' });
    actions.push({ label: '考研还是保研', text: '考研和保研怎么选？' });
  }
  if (text.includes('考研')) {
    actions.push({ label: '考研备考', text: '考研备考复习经验' });
  }
  // 提到了课程
  if (text.includes('课程') || text.includes('选课')) {
    actions.push({ label: '推荐课程', text: '课程测评 选课推荐' });
    actions.push({ label: '大一选课', text: '大一专业必修课程测评' });
  }
  // 提到了求职/实习
  if (text.includes('求职') || text.includes('实习') || text.includes('工作')) {
    actions.push({ label: '简历建议', text: '求职简历面试经验分享' });
    actions.push({ label: '实习经验', text: '有实习求职经验分享吗？' });
  }
  // 提到了出国/留学
  if (text.includes('出国') || text.includes('留学') || text.includes('申请')) {
    actions.push({ label: '留学规划', text: '出国留学申请经验分享' });
    actions.push({ label: '申请经验', text: '留学申请经历分享' });
  }
  // 提到了迷茫/焦虑/规划
  if (text.includes('迷茫') || text.includes('焦虑') || text.includes('规划') || text.includes('方向')) {
    actions.push({ label: '大学规划', text: '大学规划方向成长经验' });
    actions.push({ label: '学长学姐建议', text: '迷茫焦虑 成长心态经验分享' });
  }
  // 推荐了文章，可以继续探索
  if (text.includes('#')) {
    actions.push({ label: '看更多', text: '还有其他相关的经验分享吗？' });
    actions.push({ label: '换个方向', text: '换个方向，有什么值得看的经验分享？' });
  }

  // 通用兜底
  if (actions.length === 0) {
    actions.push({ label: '推荐文章', text: '推荐几篇值得看的经验分享' });
    actions.push({ label: '随便看看', text: '有什么保研 考研 求职的经验？' });
  }

  // 最多显示 3 个
  return actions.slice(0, 3);
}

export default function ArticleChat() {
  const { userArticles } = useSiteContent();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        '嗨～我是小 R，你的 RIEMer Land 助手 🌿\n有什么想聊的都可以跟我说～',
      articles: [],
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  // 点击推荐文章时弹出的中间预览卡片（与首页卡片一致）
  const [previewArticle, setPreviewArticle] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  // 根据对话上下文计算当前应显示的快捷指令
  const quickActions = useMemo(() => {
    // 只有初始欢迎语时，显示初始指令
    if (messages.length <= 1) return INITIAL_QUICK_ACTIONS;
    // 找到最后一条 AI 回复
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    return getContextQuickActions(lastAssistant?.content || '');
  }, [messages]);

  // ---- 语音识别 ----
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      alert('您的浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器。');
      return;
    }

    // 如果已经在监听，则停止
    if (isListening) {
      stopListening();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;

    // 保存语音开始前输入框已有的文字，避免丢失
    const prefixText = input;
    let finalTranscript = '';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      // 直接用"前缀 + 已确认 + 临时"拼接，避免依赖 prev 导致重复
      setInput(prefixText + finalTranscript + interim);
    };

    recognition.onerror = (event) => {
      console.warn('[Speech] error:', event.error);
      if (event.error === 'not-allowed') {
        alert('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问。');
      }
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      // 把最终结果写入输入框（如果 onresult 还没写入的话）
      if (finalTranscript) {
        setInput(prefixText + finalTranscript);
      }
      inputRef.current?.focus();
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }, [isListening, stopListening, input]);

  // 组件卸载或面板关闭时停止语音识别
  useEffect(() => {
    if (!isOpen) {
      stopListening();
    }
  }, [isOpen, stopListening]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 打开时聚焦输入框
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const handleSend = async (overrideText) => {
    const text = (overrideText || input).trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text, articles: [] };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const result = await sendMessage(
        newMessages.map((m) => ({ role: m.role, content: m.content })),
        userArticles
      );
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.text, articles: result.articles },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '抱歉，出了点问题，请稍后再试。',
          articles: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="article-chat">
      {/* 浮动气泡按钮 */}
      <button
        className={`article-chat__fab ${isOpen ? 'article-chat__fab--hidden' : ''}`}
        onClick={() => setIsOpen(true)}
        aria-label="打开内容助手"
      >
        <MessageCircle size={22} />
        <span className="article-chat__fab-label">内容助手</span>
      </button>

      {/* 聊天面板 */}
      <div className={`article-chat__panel ${isOpen ? 'article-chat__panel--open' : ''}`}>
        {/* 头部 */}
        <div className="article-chat__header">
          <div className="article-chat__header-info">
            <span className="article-chat__header-dot" />
            <h4>查询助手</h4>
          </div>
          <button
            className="article-chat__close"
            onClick={() => setIsOpen(false)}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* 消息区域 */}
        <div className="article-chat__messages">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`article-chat__msg ${
                msg.role === 'user' ? 'article-chat__msg--user' : 'article-chat__msg--assistant'
              }`}
            >
              <div className="article-chat__msg-bubble">
                <div className="article-chat__msg-text">{renderRichText(msg.content)}</div>
                {/* 推荐文章卡片：点击弹出中间预览卡片（与首页一致），由弹窗给出链接 */}
                {msg.articles && msg.articles.length > 0 && (
                  <div className="article-chat__recommendations">
                    {msg.articles.map((article) => (
                      <button
                        key={article.id}
                        type="button"
                        className="article-chat__rec-card"
                        onClick={() => setPreviewArticle(article)}
                      >
                        <span className="article-chat__rec-category">
                          {article.category}
                        </span>
                        <span className="article-chat__rec-title">{article.title}</span>
                        <ArrowRight size={14} className="article-chat__rec-arrow" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="article-chat__msg article-chat__msg--assistant">
              <div className="article-chat__msg-bubble article-chat__msg-loading">
                <Loader2 size={16} className="article-chat__spinner" />
                <span>思考中...</span>
              </div>
            </div>
          )}
          {/* 快捷指令 */}
          {!loading && quickActions.length > 0 && (
            <div className="article-chat__quick-actions">
              <div className="article-chat__quick-label">
                <span>试试问问</span>
              </div>
              <div className="article-chat__quick-list">
                {quickActions.map((action, idx) => (
                  <button
                    key={idx}
                    className="article-chat__quick-btn"
                    onClick={() => handleSend(action.text)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div className="article-chat__input-area">
          <input
            ref={inputRef}
            type="text"
            className="article-chat__input"
            placeholder={isListening ? '正在聆听...' : '描述你想找的内容...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          {SpeechRecognition && (
            <button
              className={`article-chat__voice ${isListening ? 'article-chat__voice--active' : ''}`}
              onClick={startListening}
              disabled={loading}
              aria-label={isListening ? '停止语音输入' : '语音输入'}
              title={isListening ? '点击停止' : '语音输入'}
            >
              {isListening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          )}
          <button
            className="article-chat__send"
            onClick={handleSend}
            disabled={!input.trim() || loading}
            aria-label="发送"
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* 推荐文章中间预览弹窗：点击推荐卡片后弹出，由弹窗内按钮给出超链接 */}
      {previewArticle && (
        <ArticlePreviewModal
          article={previewArticle}
          onClose={() => setPreviewArticle(null)}
        />
      )}
    </div>
  );
}
