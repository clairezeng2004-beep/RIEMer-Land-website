import { useState, useCallback } from 'react';
import { Send, MessageCircle, X, Check, User, Mail } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import './FooterGuestbook.css';

const GUESTBOOK_LS_KEY = 'riemer_guestbook';

export default function FooterGuestbook() {
  const [open, setOpen] = useState(false);
  const [nickname, setNickname] = useState('');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [showContact, setShowContact] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

  if (!open) {
    return (
      <div className="footer-guestbook">
        <button
          className="footer-guestbook__trigger"
          onClick={() => setOpen(true)}
        >
          <MessageCircle size={15} />
          <span>给我们留言</span>
        </button>
      </div>
    );
  }

  return (
    <div className="footer-guestbook footer-guestbook--open">
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
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="写下你想说的话…"
                className="footer-guestbook__textarea"
                rows={3}
                maxLength={500}
              />
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
    </div>
  );
}
