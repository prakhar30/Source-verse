const MAX_SLUG_LENGTH = 50;

export function slugifyTaskName(task: string): string {
  if (!task.trim()) {
    throw new Error('Task description cannot be empty');
  }

  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');

  if (!slug) {
    throw new Error('Task description must contain at least one alphanumeric character');
  }

  return `sv/${slug}`;
}
