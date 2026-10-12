import LegalPage from './LegalPage';

export default function Privacy() {
  return (
    <LegalPage title="Privacy">
      <p>This privacy note is a placeholder for Nathan to review.</p>
      <p>
        Checkout stores your email, mobile number, chosen domain, and payment plan so we can take
        payment, register a domain, and send renewal reminders by email and text. Payments are
        handled by Stripe. Texts are sent with Twilio. Email is sent from nathan@taylor-marriott.com.
      </p>
      <p>We do not sell this information. Ask nathan@taylor-marriott.com if you want a copy or a deletion.</p>
    </LegalPage>
  );
}
