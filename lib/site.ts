import { siInstagram, siTiktok, siX, siYoutube, type SimpleIcon } from 'simple-icons';

/**
 * Brand details shown in the footer and on the company/legal pages, kept in one
 * place so a changed address or handle is a one-line edit.
 */
export const SITE = {
  name: 'Aceversity',
  tagline: 'Ace Your University Journey',
  description:
    'Explore the real course catalog of top-ranked worldwide universities, then practice every section of a course with AI-generated questions.',
  emails: {
    support: 'support@aceversity.com',
    hello: 'hello@aceversity.com',
    privacy: 'privacy@aceversity.com',
    legal: 'legal@aceversity.com',
  },
  // Effective date printed on the privacy policy and terms.
  legalUpdated: 'September 17, 2026',
} as const;

export interface SocialLink {
  label: string;
  href: string;
  icon: SimpleIcon;
}

export const SOCIAL_LINKS: SocialLink[] = [
  { label: 'Aceversity on X', href: 'https://x.com/aceversity', icon: siX },
  {
    label: 'Aceversity on Instagram',
    href: 'https://instagram.com/ace.versity',
    icon: siInstagram,
  },
  {
    label: 'Aceversity on TikTok',
    href: 'https://tiktok.com/@aceversity',
    icon: siTiktok,
  },
  {
    label: 'Aceversity on YouTube',
    href: 'https://youtube.com/@aceversity',
    icon: siYoutube,
  },
];

export const FOOTER_NAV = [
  {
    title: 'Product',
    links: [
      { href: '/', label: 'Explore courses' },
      { href: '/auth/login', label: 'Start Acing' },
      { href: '/support', label: 'Help center' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/terms', label: 'Terms of service' },
      { href: '/privacy#cookies', label: 'Cookies' },
    ],
  },
] as const;
