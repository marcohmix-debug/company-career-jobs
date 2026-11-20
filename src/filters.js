// Filters chosen in the input. The same test runs on a job read in full and, for platforms that
// list jobs before their text, on the short list entry (description null: text filters are skipped then).

const words = (list) => (Array.isArray(list) ? list : []).map((word) => String(word).trim().toLowerCase()).filter(Boolean);

export function makeFilter(input, now = Date.now()) {
    const titleAny = words(input.titleKeywords);
    const titleNone = words(input.excludeTitleKeywords);
    const places = words(input.locationKeywords);
    const textAny = words(input.descriptionKeywords);
    const days = Number(input.postedInLastDays) > 0 ? Number(input.postedInLastDays) : null;
    const remoteOnly = input.remoteOnly === true;

    return (job) => {
        const title = (job.title ?? '').toLowerCase();
        if (titleAny.length && !titleAny.some((word) => title.includes(word))) return false;
        if (titleNone.some((word) => title.includes(word))) return false;
        // locations null: a list entry that does not say where the job is; the place filters wait for the full job.
        if (job.locations !== null) {
            const where = (job.locations ?? []).join(' | ').toLowerCase();
            const remote = job.workplaceType === 'remote' || /\bremote\b/.test(where) || /\bremote\b/.test(title);
            if (remoteOnly && !remote) return false;
            if (places.length && !places.some((word) => where.includes(word))) return false;
        }
        if (days && job.publishedAt && now - new Date(job.publishedAt).getTime() > days * 86400000) return false;
        // A job without a publication date cannot be said to be recent.
        if (days && !job.publishedAt) return false;
        if (textAny.length && job.description !== null) {
            const text = `${title}\n${job.description}`.toLowerCase();
            if (!textAny.some((word) => text.includes(word))) return false;
        }
        return true;
    };
}
