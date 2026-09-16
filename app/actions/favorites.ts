'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/supabase/server';

const ToggleSchema = z.union([
  z.object({ collegeId: z.string().uuid() }),
  z.object({ courseId: z.string().uuid() }),
]);

export interface ToggleFavoriteResult {
  ok: boolean;
  favorited?: boolean;
  error?: string;
}

/**
 * Stars or un-stars a college or a course for the signed-in user.
 *
 * Idempotent per target: the partial unique indexes mean a double-click can't
 * create two rows, and an un-star of something not starred is a no-op.
 */
export async function toggleFavorite(
  input: { collegeId: string } | { courseId: string },
): Promise<ToggleFavoriteResult> {
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid favourite target.' };

  const user = await getUser();
  if (!user) return { ok: false, error: 'Sign in to save favourites.' };

  const admin = createAdminClient();
  const collegeId = 'collegeId' in parsed.data ? parsed.data.collegeId : null;
  const courseId = 'courseId' in parsed.data ? parsed.data.courseId : null;
  const column = collegeId ? 'college_id' : 'course_id';

  const { data: existing } = await admin
    .from('favorites')
    .select('id')
    .eq('user_id', user.id)
    .eq(column, (collegeId ?? courseId)!)
    .maybeSingle();

  if (existing) {
    const { error } = await admin.from('favorites').delete().eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
    revalidateFavorites();
    return { ok: true, favorited: false };
  }

  const { error } = await admin
    .from('favorites')
    .insert({ user_id: user.id, college_id: collegeId, course_id: courseId });

  if (error) return { ok: false, error: error.message };

  revalidateFavorites();
  return { ok: true, favorited: true };
}

function revalidateFavorites(): void {
  // The dashboard is the only place that renders the full list.
  revalidatePath('/');
}
