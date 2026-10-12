import { Link } from 'react-router-dom';

export default function LegalPage({ title, children }) {
  return (
    <main className="checkout-page legal-page">
      <div className="checkout-layout">
        <p className="checkout-banner" role="note">
          Placeholder for Nathan to review before this page is treated as final.
        </p>
        <h1 className="checkout-title">{title}</h1>
        <div className="checkout-card legal-page__body">{children}</div>
        <p className="checkout-meta">
          <Link to="/checkout">Back to checkout</Link>
        </p>
      </div>
    </main>
  );
}
