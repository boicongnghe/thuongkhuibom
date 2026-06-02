export default function Pagination({ current, total, onPage }) {
  if (!total || total <= 1) return null;

  const pages = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - current) <= 1) {
      pages.push({ type: 'page', n: i });
    } else if (Math.abs(i - current) === 2) {
      pages.push({ type: 'dots', n: i });
    }
  }

  return (
    <div className="pagination">
      {current > 1 && (
        <button className="page-btn" onClick={() => onPage(current - 1)}>‹</button>
      )}
      {pages.map((p, i) =>
        p.type === 'dots'
          ? <span key={`d${i}`} className="page-dots">…</span>
          : <button
              key={p.n}
              className={`page-btn${p.n === current ? ' active' : ''}`}
              onClick={() => onPage(p.n)}
            >{p.n}</button>
      )}
      {current < total && (
        <button className="page-btn" onClick={() => onPage(current + 1)}>›</button>
      )}
    </div>
  );
}
