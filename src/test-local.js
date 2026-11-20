// Reads a few real job boards and prints what came back. Usage: node src/test-local.js [company...]
import { parseCompany, readCompany } from './ats.js';

const lines = process.argv.slice(2).length ? process.argv.slice(2) : [
    'https://boards.greenhouse.io/stripe', 'https://jobs.ashbyhq.com/ramp', 'https://jobs.lever.co/palantir',
    'https://apply.workable.com/huggingface', 'smartrecruiters:Bosch', 'https://bunq.recruitee.com', 'https://personio.jobs.personio.de',
    'notion', 'zzzznotacompany123', 'http://example.com/careers',
];
for (const line of lines) {
    const company = parseCompany(line);
    if (company.error) { console.log(`${line} -> ${company.error}`); continue; }
    const started = Date.now();
    const result = await readCompany(company, { maxJobs: 6 });
    if (result.status !== 'ok') { console.log(`${line} -> ${result.status}: ${result.reason}`); continue; }
    const first = result.jobs[0];
    const filled = (key) => result.jobs.filter((job) => (Array.isArray(job[key]) ? job[key].length : job[key])).length;
    console.log(`${line} -> ${result.platform}${result.guessed ? ' (guessed)' : ''}, ${result.jobs.length} jobs, ${Date.now() - started} ms`);
    console.log(`   filled: ${['company', 'title', 'department', 'locations', 'country', 'workplaceType', 'employmentType', 'salary', 'publishedAt', 'url', 'description'].map((key) => `${key} ${filled(key)}`).join(', ')}`);
    if (first) console.log(`   first: ${JSON.stringify({ ...first, description: `${first.description.slice(0, 160)}… (${first.description.length} chars)` })}`);
}
