/**
 * Display helpers for universities. The catalog mixes two rankings — US News
 * for US schools, QS World for the rest — so a bare "#8" is ambiguous; these
 * keep the list a rank came from next to it.
 */

export const US_COUNTRY = 'United States';

export type CollegeRegion = 'us' | 'intl';

interface CollegeLike {
  city: string | null;
  state: string | null;
  country: string;
  rank: number | null;
  rank_source: string;
}

export function collegeRegion(college: Pick<CollegeLike, 'country'>): CollegeRegion {
  // Rows read before migration 0016 have no country; they're all US schools.
  return (college.country ?? US_COUNTRY) === US_COUNTRY ? 'us' : 'intl';
}

export const REGION_LABEL: Record<CollegeRegion, string> = {
  us: 'United States',
  intl: 'International',
};

/** The state for US schools, the country elsewhere. */
export function placeName(college: Pick<CollegeLike, 'state' | 'country'>): string | null {
  return collegeRegion(college) === 'us' ? college.state : college.country;
}

/** "Cambridge, MA" for US schools, "London, United Kingdom" elsewhere. */
export function formatLocation(college: Pick<CollegeLike, 'city' | 'state' | 'country'>): string {
  const place = placeName(college);
  // City-states list the same name twice in the source data.
  const parts = college.city === place ? [place] : [college.city, place];
  return parts.filter(Boolean).join(', ');
}

/** "#12 nationally (US News)" or "#8 worldwide (QS 2027)". */
export function describeRank(
  college: Pick<CollegeLike, 'rank' | 'rank_source' | 'country'>,
): string | null {
  if (college.rank === null) return null;
  const scope = collegeRegion(college) === 'us' ? 'nationally' : 'worldwide';
  return `#${college.rank} ${scope} (${college.rank_source})`;
}

/** Region filter for admin bulk runs; `all` spans both ranking lists. */
export type RegionFilter = CollegeRegion | 'all';

export function matchesRegion(country: string, region: RegionFilter = 'all'): boolean {
  return region === 'all' || collegeRegion({ country }) === region;
}
