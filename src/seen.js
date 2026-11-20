// Memory of the jobs already delivered, for the "only new jobs" mode. It lives in a named key-value
// store of the user's account, so it outlasts the run; one record per monitor name.
import { Actor } from 'apify';

export const SEEN_STORE = 'company-career-jobs-seen';
// A job not met for this long is forgotten, so the record does not grow for ever.
const FORGET_AFTER_DAYS = 180;

export const seenKey = (name) => {
    const slug = String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return `seen-${slug || 'default'}`;
};

export class SeenJobs {
    static async open(name) {
        const store = await Actor.openKeyValueStore(SEEN_STORE);
        const key = seenKey(name);
        const record = await store.getValue(key);
        return new SeenJobs(store, key, record?.jobs && typeof record.jobs === 'object' ? record.jobs : {});
    }

    constructor(store, key, jobs, now = new Date()) {
        this.store = store;
        this.key = key;
        this.jobs = jobs;
        this.now = now.toISOString();
        this.firstRun = !Object.keys(jobs).length;
    }

    // True for a job delivered by an earlier run. Meeting it again keeps it remembered.
    has(id) {
        if (!id || !(id in this.jobs)) return false;
        this.jobs[id] = this.now;
        return true;
    }

    add(id) {
        if (id) this.jobs[id] = this.now;
    }

    async save() {
        const limit = Date.parse(this.now) - FORGET_AFTER_DAYS * 86400000;
        for (const [id, lastMet] of Object.entries(this.jobs)) {
            if (!(Date.parse(lastMet) >= limit)) delete this.jobs[id];
        }
        await this.store.setValue(this.key, { updatedAt: this.now, jobs: this.jobs });
    }
}
