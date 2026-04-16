import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, MessageCircle, X, Check, User, Mail, Mic, MicOff } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import './FooterGuestbook.css';

const GUESTBOOK_LS_KEY = 'riemer_guestbook';

// 检测浏览器是否支持 Web Speech API
const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export default function FooterGuestbook() {
  const [open, setOpen] = useState(false);
  const [nickname, setNickname] = useState('');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [showContact, setShowContact] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  // 清理语音识别
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  const toggleSpeech = useCallback(() => {
    if (!SpeechRecognition) {
      alert('您的浏览器不支持语音输入，请使用 Chrome 或 Safari 浏览器');
      return;
    }

    if (listening) {
      // 停止录音
      recognitionRef.current?.stop();
      return;
    }

    // 开始录音
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalTranscript = '';

    recognition.onstart = () => setListening(true);

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
      // 实时更新：已确认的文字 + 正在识别的文字
      setMessage((prev) => {
        const base = prev.endsWith(finalTranscript) ? prev : prev + finalTranscript;
        // 保持在 500 字限制内
        const combined = (base + interim).slice(0, 500);
        return combined;
      });
    };

    recognition.onerror = (event) => {
      console.warn('[Speech] 识别出错:', event.error);
      if (event.error === 'not-allowed') {
        alert('请允许麦克风权限以使用语音输入');
      }
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      // 把最终结果合并到 message
      if (finalTranscript) {
        setMessage((prev) => {
          const result = (prev.includes(finalTranscript) ? prev : prev + finalTranscript).slice(0, 500);
          return result;
        });
      }
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [listening]);

  const handleSubmit = useCallback(async () => {
    if (!message.trim()) return;
    setSubmitting(true);

    const entry = {
      id: `gb-${Date.now()}`,
      nickname: nickname.trim() || '匿名访客',
      message: message.trim(),
      contact: showContact ? contact.trim() : '',
      show_contact: showContact,
      created_at: new Date().toISOString(),
    };

    try {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.from('guestbook_entries').insert({
          nickname: entry.nickname,
          message: entry.message,
          contact: entry.contact,
          show_contact: entry.show_contact,
        });
        if (error) throw error;
      } else {
        // localStorage fallback
        const stored = JSON.parse(localStorage.getItem(GUESTBOOK_LS_KEY) || '[]');
        stored.unshift(entry);
        localStorage.setItem(GUESTBOOK_LS_KEY, JSON.stringify(stored));
      }

      setSubmitted(true);
      setMessage('');
      setNickname('');
      setContact('');
      setShowContact(false);
      setTimeout(() => {
        setSubmitted(false);
        setOpen(false);
      }, 2000);
    } catch (err) {
      console.error('[Guestbook] 提交留言失败:', err);
      alert('留言提交失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }, [nickname, message, contact, showContact]);

  return (
    <div className="footer-guestbook">
      {/* 按钮始终渲染，保持固定高度，避免弹窗关闭时高度弹跳 */}
      <button
        className={`footer-guestbook__trigger${open ? ' footer-guestbook__trigger--hidden' : ''}`}
        onClick={() => setOpen(true)}
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
      >
        <MessageCircle size={15} />
        <span>给我们留言</span>
      </button>

      {open && (
        <div className="footer-guestbook__panel">
          <div className="footer-guestbook__header">
            <h4 className="footer-guestbook__title">
              <MessageCircle size={16} /> 留言板
            </h4>
            <button
              className="footer-guestbook__close"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>

          <p className="footer-guestbook__desc">
            欢迎留下你想对我们说的话 ✨
          </p>

          {submitted ? (
            <div className="footer-guestbook__success">
              <Check size={20} />
              <span>留言成功，感谢你的反馈！</span>
            </div>
          ) : (
            <>
              <div className="footer-guestbook__field">
                <div className="footer-guestbook__input-wrap">
                  <User size={14} className="footer-guestbook__input-icon" />
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="你的昵称（可选）"
                    className="footer-guestbook__input"
                    maxLength={30}
                  />
                </div>
              </div>

              <div className="footer-guestbook__field">
                <div className="footer-guestbook__textarea-wrap">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="写下你想说的话…"
                    className={`footer-guestbook__textarea${listening ? ' footer-guestbook__textarea--listening' : ''}`}
                    rows={3}
                    maxLength={500}
                  />
                  {SpeechRecognition && (
                    <button
                      type="button"
                      className={`footer-guestbook__voice-btn${listening ? ' footer-guestbook__voice-btn--active' : ''}`}
                      onClick={toggleSpeech}
                      title={listening ? '停止语音输入' : '语音输入'}
                      aria-label={listening ? '停止语音输入' : '语音输入'}
                    >
                      {listening ? <MicOff size={16} /> : <Mic size={16} />}
                      <span className="footer-guestbook__voice-label">{listening ? '停止' : '语音输入'}</span>
                    </button>
                  )}
                </div>
                {listening && (
                  <span className="footer-guestbook__listening-hint">
                    <span className="footer-guestbook__listening-dot" />
                    正在聆听…
                  </span>
                )}
                <span className="footer-guestbook__char-count">
                  {message.length}/500
                </span>
              </div>

              <div className="footer-guestbook__contact-toggle">
                <label className="footer-guestbook__checkbox-label">
                  <input
                    type="checkbox"
                    checked={showContact}
                    onChange={(e) => setShowContact(e.target.checked)}
                    className="footer-guestbook__checkbox"
                  />
                  <span>留下联系方式</span>
                </label>
              </div>

              {showContact && (
                <div className="footer-guestbook__field">
                  <div className="footer-guestbook__input-wrap">
                    <Mail size={14} className="footer-guestbook__input-icon" />
                    <input
                      type="text"
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      placeholder="邮箱 / 微信 / 手机号"
                      className="footer-guestbook__input"
                      maxLength={100}
                    />
                  </div>
                </div>
              )}

              <button
                className="footer-guestbook__submit"
                disabled={!message.trim() || submitting}
                onClick={handleSubmit}
              >
                {submitting ? (
                  <span>提交中…</span>
                ) : (
                  <>
                    <Send size={14} />
                    <span>提交留言</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
