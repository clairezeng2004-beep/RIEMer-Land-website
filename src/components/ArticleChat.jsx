import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, X, Send, ArrowRight, Loader2, Mic, MicOff } from 'lucide-react';
import { sendMessage } from '../services/chatService';
import './ArticleChat.css';

// 浏览器 SpeechRecognition 兼容处理
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function ArticleChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        '你好！我是内容助手 🌿\n我可以帮你找到感兴趣的内容，试试描述你想了解的内容吧，比如：\n\n• 有没有关于保研的经验？\n• 我想看课程测评\n• 求职相关的分享',
      articles: [],
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

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
      // 实时更新输入框：已确认文字 + 临时文字
      setInput((prev) => {
        const base = prev.replace(/\u200B.*$/, ''); // 清理之前的临时标记
        return finalTranscript || base + interim;
      });
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
      // 把最终结果写入输入框
      if (finalTranscript) {
        setInput((prev) => prev || finalTranscript);
      }
      inputRef.current?.focus();
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }, [isListening, stopListening]);

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
            <h4>内容助手</h4>
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
    </div>
  );
}
