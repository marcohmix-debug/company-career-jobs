import { Actor, log } from 'apify';
import { parseCompany, readCompany } from './ats.js';
import { makeFilter } from './filters.js';
import { BriefWriter } from './brief.js';
import { SeenJobs } from './seen.js';

const OWNER_USER_ID = 'fMBVwOHrKruyIxiD7';
// Briefs are written a few at a time: each takes two model calls.
const BRIEFS_AT_ONCE = 5;

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const lines = (Array.isArray(input.companies) ? input.companies : []).map((line) => String(line).trim()).filter(Boolean);
if (!lines.length) {
    await Actor.fail('Add at least one company: a career page address (for example https://jobs.ashbyhq.com/ramp), "platform:name", or the short name the company uses on its hiring platform.');
}

// Pay-per-event. On a run without pay-per-event pricing the charge is ignored;
// when the user's budget for the run is used up, the result says so.
async function charge(eventName) {
    try {
        const result = await Actor.charge({ eventName, count: 1 });
        return !result?.eventChargeLimitReached;
    } catch (error) {
        log.debug(`Charging skipped: ${error.message}`);
        return true;
    }
}

let writer = null;
if (input.aiBrief) {
    if (!process.env.ANTHROPIC_API_KEY) {
        await Actor.fail('The AI brief is not configured on this actor (missing ANTHROPIC_API_KEY). Run it with "AI brief" turned off.');
    }
    // Only the actor's owner may pick the model for a run: the owner pays for the tokens.
    const ownerRun = Actor.getEnv().userId === OWNER_USER_ID;
    const model = ownerRun && typeof input.briefModel === 'string' ? input.briefModel : undefined;
    writer = new BriefWriter({ language: input.language, ...(model ? { model } : {}) });
    log.info(`Briefs will be written with ${writer.model}.`);
}

const positive = (value) => (Number(value) > 0 ? Number(value) : Infinity);
const maxItems = positive(input.maxItems);
const maxPerCompany = positive(input.maxJobsPerCompany);
const maxBriefs = positive(input.maxBriefs);
const matches = makeFilter(input);

// "Only new jobs": a job saved by an earlier run of the same monitor is left out, before its
// details are read and before the limits are applied. A job counts as seen only once it is saved.
const seen = input.onlyNew ? await SeenJobs.open(input.monitorName) : null;
if (seen) log.info(seen.firstRun ? `Only new jobs: first run of the monitor "${seen.key}", every matching job is new.` : `Only new jobs: monitor "${seen.key}" remembers ${Object.keys(seen.jobs).length} jobs.`);
let skipped = new Set();
const keep = !seen ? matches : (job) => {
    if (!matches(job)) return false;
    if (!seen.has(job.id)) return true;
    skipped.add(job.id);
    return false;
};

let saved = 0;
let briefsTried = 0;
let withinBudget = true;
const summary = [];

try {
    for (const line of lines) {
        if (saved >= maxItems || !withinBudget) break;
        const company = parseCompany(line);
        skipped = new Set();
        if (company.error) {
            log.warning(`"${line}": ${company.error}`);
            summary.push({ input: line, status: 'not_understood', reason: company.error, jobsOpen: null, jobsSaved: 0 });
            continue;
        }
        const result = await readCompany(company, { keep, maxJobs: Math.min(maxPerCompany, maxItems - saved) });
        if (result.status !== 'ok') {
            log.warning(`"${line}": ${result.reason}`);
            summary.push({ input: line, status: result.status, reason: result.reason, jobsOpen: null, jobsSaved: 0 });
            continue;
        }
        if (result.guessed) log.info(`"${line}": found on ${result.platform}. If this is not the company you meant, give its career page address instead.`);

        const jobs = result.jobs.filter(keep).slice(0, Math.min(maxPerCompany, maxItems - saved));
        const openJobs = result.jobs.totalOpen ?? result.jobs.length;
        log.info(`"${line}": ${openJobs} open jobs on ${result.platform}, ${jobs.length} taken after filters and limits${seen ? `, ${skipped.size} already delivered by an earlier run` : ''}.`);

        let savedHere = 0;
        for (let start = 0; start < jobs.length && withinBudget; start += BRIEFS_AT_ONCE) {
            const batch = jobs.slice(start, start + BRIEFS_AT_ONCE);
            const briefs = await Promise.all(batch.map((job) => {
                if (!writer) return null;
                if (briefsTried >= maxBriefs) return { status: 'skipped', reason: 'Limit of briefs for this run reached.' };
                briefsTried++;
                return writer.write(job);
            }));
            for (let index = 0; index < batch.length; index++) {
                const job = batch[index];
                const brief = briefs[index];
                let ok = true;
                if (brief) {
                    job.aiBrief = brief;
                    if (brief.status === 'ok') ok = await charge('ai-brief');
                    else if (brief.status !== 'skipped') log.info(`${job.id}: brief not written (${brief.status}${brief.reason ? `: ${brief.reason}` : ''}).`);
                }
                job.platformGuessed = result.guessed;
                if (input.includeDescription === false) delete job.description;
                await Actor.pushData(job);
                seen?.add(job.id);
                saved++;
                savedHere++;
                ok = (await charge('job')) && ok;
                if (!ok) {
                    withinBudget = false;
                    log.info('The budget set for this run is used up: stopping here.');
                    break;
                }
            }
        }
        summary.push({ input: line, status: 'ok', platform: result.platform, platformGuessed: result.guessed, jobsOpen: openJobs, jobsSaved: savedHere, ...(seen ? { jobsAlreadySeen: skipped.size } : {}) });
    }
} catch (error) {
    log.error(error.message);
    await Actor.setValue('SUMMARY', summary);
    // What was saved before the error must not come back as new on the next run.
    await seen?.save().catch((saveError) => log.warning(`Memory of delivered jobs not saved: ${saveError.message}`));
    await Actor.fail(error.message);
}

await Actor.setValue('SUMMARY', summary);
await seen?.save();

if (writer) {
    const { written, calls, inputTokens, outputTokens } = writer.usage;
    if (writer.auditFailures) log.warning(`Briefs left unaudited: ${writer.auditFailures} (last reason: ${writer.lastAuditFailure}).`);
    log.info(`Briefs written: ${written} of ${briefsTried} tried (${calls} calls, ${inputTokens} input and ${outputTokens} output tokens, model ${writer.model}).`);
}
const missed = summary.filter((row) => row.status !== 'ok');
if (missed.length) log.warning(`Companies not read: ${missed.length} of ${lines.length} (${missed.map((row) => row.input).join(', ')}). Details in the SUMMARY record of the key-value store.`);
log.info(`Saved ${saved} jobs from ${summary.length - missed.length} companies to the dataset.`);
// A run where no company could be read gives the user nothing: say so in the run status.
if (seen && !saved && missed.length < lines.length) log.info('No new jobs since the last run of this monitor.');
if (!saved && missed.length === lines.length) await Actor.fail('None of the companies could be read. Check the names or give the career page addresses.');
await Actor.exit();
