import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage, Prose } from '@/components/layout/content-page';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: `How ${SITE.name} collects, uses and protects your information.`,
};

export default function PrivacyPage() {
  return (
    <ContentPage eyebrow="Legal" title="Privacy policy" intro={`Last updated ${SITE.legalUpdated}`}>
      <Prose>
        <p>
          This policy explains what information {SITE.name} (“we”, “us”) collects when you use our
          website and services, how we use it, and the choices you have. We collect only what we
          need to run the service, and we do not sell your personal information.
        </p>

        <h2>Information we collect</h2>
        <h3>Information you give us</h3>
        <ul>
          <li>
            <strong>Account details</strong> — your email address, used to send sign-in links and
            identify your account.
          </li>
          <li>
            <strong>Messages</strong> — your name, email and message when you contact us.
          </li>
        </ul>
        <h3>Information created as you use the service</h3>
        <ul>
          <li>
            <strong>Activity</strong> — universities and courses you save, practice tests you
            generate, and your answers and scores.
          </li>
          <li>
            <strong>Searches</strong> — the text you type into course search, used to find matching
            courses.
          </li>
          <li>
            <strong>Usage and technical data</strong> — records of AI generation requests tied to
            your account, plus standard server logs such as IP address, browser type and pages
            requested.
          </li>
        </ul>

        <h2>How we use information</h2>
        <ul>
          <li>
            To provide the service: sign you in, show your saved items and test history, and
            generate practice questions.
          </li>
          <li>To answer your questions and support requests.</li>
          <li>To keep the service secure, prevent abuse, and monitor usage and costs.</li>
          <li>To fix problems and improve features.</li>
        </ul>
        <p>We do not use your information for advertising and we do not sell or rent it.</p>

        <h2>Service providers</h2>
        <p>
          We share information only with providers that help us run {SITE.name}, under terms that
          protect it:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> — database and account authentication.
          </li>
          <li>
            <strong>Vercel</strong> — website hosting and routing of AI requests.
          </li>
          <li>
            <strong>AI model providers</strong> (such as Anthropic and OpenAI, through Vercel’s AI
            Gateway) — course information and search text are sent to generate questions and find
            matching courses. We do not send your email address with these requests.
          </li>
          <li>
            <strong>Email delivery providers</strong> — to send sign-in links and replies.
          </li>
        </ul>
        <p>
          We may also disclose information if required by law, or to protect the rights and safety
          of our users and the service.
        </p>

        <h2 id="cookies">Cookies and local storage</h2>
        <p>
          We use strictly necessary cookies to keep you signed in. Your browser’s local storage
          remembers preferences such as light or dark theme and your preferred search mode. We do
          not use advertising or cross-site tracking cookies.
        </p>

        <h2>Retention</h2>
        <p>
          We keep account data while your account is active. When you ask us to delete your account,
          we delete your personal information within 30 days, except where we must keep it for legal
          or security reasons. Practice question sets you generate may remain in our shared library
          without any link to you.
        </p>

        <h2>Your rights and choices</h2>
        <p>
          Depending on where you live, you may have the right to access, correct, export or delete
          your personal information, and to object to certain uses. To make a request, email{' '}
          <a href={`mailto:${SITE.emails.privacy}`}>{SITE.emails.privacy}</a> from the address on
          your account. We will not discriminate against you for exercising these rights.
        </p>

        <h2>Security</h2>
        <p>
          We use encryption in transit, access controls and row-level database security to protect
          your information. No system is perfectly secure, so please contact us right away if you
          believe your account has been compromised.
        </p>

        <h2>Children</h2>
        <p>
          {SITE.name} is intended for students aged 13 and older. We do not knowingly collect
          information from children under 13. If you believe a child has given us information,
          contact us and we will delete it.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          We may update this policy from time to time. We will change the date at the top and, for
          significant changes, let you know by email or on the site.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about privacy? Email{' '}
          <a href={`mailto:${SITE.emails.privacy}`}>{SITE.emails.privacy}</a> or use our{' '}
          <Link href="/contact">contact form</Link>.
        </p>
      </Prose>
    </ContentPage>
  );
}
