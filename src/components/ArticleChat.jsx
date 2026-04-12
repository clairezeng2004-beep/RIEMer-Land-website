import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, X, Send, ArrowRight, Loader2 } from 'lucide-react';
import { sendMessage } from '../services/chatService';
import './ArticleChat.css';

export default function ArticleChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        '你好！我是文章助手 🌿\n我可以帮你找到感兴趣的文章，试试描述你想了解的内容吧，比如：\n\n• 有没有关于保研的经验？\n• 我想看课程测评\n• 求职相关的分享',
      articles: [],
    },
  ]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text, articles: [] };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const result = await sendMessage(
        newMessages
          .filter((m) => m.role !== 'assistant' || newMessages.indexOf(m) === 0)
          .map((m) => ({ role: m.role, content: m.content }))
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
        aria-label="打开文章助手"
      >
        <MessageCircle size={22} />
        <span className="article-chat__fab-label">文章助手</span>
      </button>

      {/* 聊天面板 */}
      <div className={`article-chat__panel ${isOpen ? 'article-chat__panel--open' : ''}`}>
        {/* 头部 */}
        <div className="article-chat__header">
          <div className="article-chat__header-info">
            <span className="article-chat__header-dot" />
            <h4>文章助手</h4>
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
                <div className="article-chat__msg-text">{msg.content}</div>
                {/* 推荐文章卡片 */}
                {msg.articles && msg.articles.length > 0 && (
                  <div className="article-chat__recommendations">
                    {msg.articles.map((article) => (
                      <Link
                        key={article.id}
                        to={`/article/${article.id}`}
                        className="article-chat__rec-card"
                        onClick={() => setIsOpen(false)}
                      >
                        <span className="article-chat__rec-category">
                          {article.category}
                        </span>
                        <span className="article-chat__rec-title">{article.title}</span>
                        <ArrowRight size={14} className="article-chat__rec-arrow" />
                      </Link>
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
                <span>正在查找...</span>
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
            placeholder="描述你想找的文章..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
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
    </div>
  );
}
