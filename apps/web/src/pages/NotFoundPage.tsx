import { Compass } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="empty-state">
      <Compass aria-hidden="true" size={32} />
      <p className="eyebrow">404</p>
      <h1>这条路径不在当前工作图里。</h1>
      <p>回到今日页面，继续处理需要你关注的事项。</p>
      <Link className="button button--primary" to="/">回到今日</Link>
    </section>
  );
}
