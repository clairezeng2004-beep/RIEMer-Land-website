import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MapPin, Copy, Check } from 'lucide-react';
import { clubInfo } from '../data/siteData';
import { useSiteContent } from '../contexts/SiteContentContext';
import './Footer.css';

export default function Footer() {
  const { content } = useSiteContent();
  const [emailCopied, setEmailCopied] = useState(false);

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(content.footerEmail);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      // fallback
      const textarea = document.createElement('textarea');
      textarea.value = content.footerEmail;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    }
  };

  return (
    <footer className="footer">

      <div className="footer__content">
        <div className="container">
          <div className="footer__grid">
            <div className="footer__nav">
              <h4 className="footer__nav-title">导航</h4>
              <Link to="/" className="footer__nav-link">首页</Link>
              <Link to="/articles" className="footer__nav-link">分享回顾</Link>
              <Link to="/timeline" className="footer__nav-link">关于我们</Link>
            </div>

            <div className="footer__nav">
              <h4 className="footer__nav-title">关于我们</h4>
              <span className="footer__nav-text">RIEM 学生互助平台</span>
              <span className="footer__nav-text">经验交流 · 心得共享</span>
              <span className="footer__nav-text">朋辈互助 · 多元可能</span>
            </div>

            <div className="footer__nav">
              <h4 className="footer__nav-title">联系方式</h4>
              <div className="footer__contact-item">
                <Mail size={16} />
                <span>{content.footerEmail}</span>
                <button
                  className="footer__copy-btn"
                  onClick={handleCopyEmail}
                  title="复制邮箱"
                  aria-label="复制邮箱"
                >
                  {emailCopied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              <div className="footer__contact-spacer" aria-hidden="true" />
              <div className="footer__contact-item">
                <MapPin size={16} />
                <span>{content.footerLocation}</span>
              </div>
            </div>

            <div className="footer__qrcode">
              <h4 className="footer__nav-title">关注公众号</h4>
              <img
                src="/qrcode-wechat.jpg"
                alt="RIEMer Land 微信公众号二维码"
                className="footer__qrcode-img"
              />
              <span className="footer__qrcode-text">微信扫码关注</span>
            </div>
          </div>

          <div className="footer__bottom">
            <p>© {new Date().getFullYear()} {clubInfo.name}.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
