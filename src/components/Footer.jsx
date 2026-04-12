import { Link } from 'react-router-dom';
import { Mail, MapPin } from 'lucide-react';
import { clubInfo } from '../data/siteData';
import { useSiteContent } from '../contexts/SiteContentContext';
import './Footer.css';

export default function Footer() {
  const { content } = useSiteContent();

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
              <span className="footer__nav-link">RIEM 学生互助平台</span>
              <span className="footer__nav-link">经验交流 · 心得共享</span>
              <span className="footer__nav-link">朋辈互助 · 多元可能</span>
            </div>

            <div className="footer__nav">
              <h4 className="footer__nav-title">联系方式</h4>
              <div className="footer__contact-item">
                <Mail size={16} />
                <span>{content.footerEmail}</span>
              </div>
              <div className="footer__contact-item">
                <MapPin size={16} />
                <span>{content.footerLocation}</span>
              </div>
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
