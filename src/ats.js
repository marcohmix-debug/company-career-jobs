// Reads the open jobs of a company from the public job-board endpoint of its hiring platform (ATS).
// Every endpoint used here is published by the platform for career pages and needs no login.

const TIMEOUT_MS = 30000;
const USER_AGENT = 'company-career-jobs/0.1 (Apify Actor)';

export const PLATFORMS = ['greenhouse', 'ashby', 'lever', 'workable', 'smartrecruiters', 'recruitee', 'personio'];
// A bare name can be looked up only where the name alone is the address.
const GUESSABLE = PLATFORMS;

/** GET with a timeout and two retries on temporary errors. Returns { status, body } where body is text. */
async function get(url, { accept = 'application/json' } = {}) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT, Accept: accept },
                signal: AbortSignal.timeout(TIMEOUT_MS),
                redirect: 'follow',
            });
            if (response.status === 429 || response.status >= 500) {
                lastError = new Error(`HTTP ${response.status}`);
                continue;
            }
            return { status: response.status, body: await response.text() };
        } catch (error) {
            lastError = error;
        }
    }
    throw new Error(`Request failed: ${url} (${lastError?.message ?? 'unknown error'})`);
}

async function getJson(url) {
    const { status, body } = await get(url);
    if (status === 404) return null;
    if (status !== 200) throw new Error(`HTTP ${status} from ${new URL(url).host}`);
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', euro: '€', pound: '£', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™' };

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
        if (code[0] === '#') {
            const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
        }
        return ENTITIES[code.toLowerCase()] ?? whole;
    });
}

/** HTML to readable plain text: paragraphs and list items on their own lines. */
export function htmlToText(html) {
    if (!html) return '';
    let text = String(html);
    // Some platforms send HTML with its tags written as entities.
    if (!/<[a-z]/i.test(text) && /&lt;[a-z]/i.test(text)) text = decodeEntities(text);
    text = text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section)>/gi, '\n')
        .replace(/<h[1-6][^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    return decodeEntities(text)
        .replace(/ /g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const isoDate = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const unique = (list) => [...new Set(list.map(clean).filter(Boolean))];

function workplace(type, remoteFlag) {
    const text = String(type ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (text.includes('hybrid')) return 'hybrid';
    if (text.includes('remote')) return 'remote';
    if (text.includes('onsite') || text.includes('office')) return 'onsite';
    if (remoteFlag === true) return 'remote';
    return null;
}

function job(platform, slug, fields) {
    const locations = unique(fields.locations ?? []);
    return {
        id: `${platform}:${slug}:${fields.jobId}`,
        platform,
        companySlug: slug,
        company: clean(fields.company),
        title: clean(fields.title),
        department: clean(fields.department),
        team: clean(fields.team),
        locations,
        country: clean(fields.country),
        workplaceType: fields.workplaceType ?? null,
        employmentType: clean(fields.employmentType),
        salary: fields.salary ?? null,
        publishedAt: isoDate(fields.publishedAt),
        updatedAt: isoDate(fields.updatedAt),
        url: clean(fields.url),
        applyUrl: clean(fields.applyUrl) ?? clean(fields.url),
        requisitionId: clean(fields.requisitionId),
        language: clean(fields.language),
        description: fields.description ?? '',
    };
}

function smartLocation(place) {
    const full = clean(place.fullLocation)?.replace(/,(\s*,)+/g, ',');
    return full ?? [place.city, place.region, place.country?.toUpperCase()].filter(Boolean).join(', ');
}

const readers = {
    async greenhouse(slug) {
        const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`);
        if (!data?.jobs) return null;
        return data.jobs.map((item) => job('greenhouse', slug, {
            jobId: item.id,
            company: item.company_name,
            title: item.title,
            department: item.departments?.map((d) => d.name).filter(Boolean).join(', '),
            locations: [item.location?.name, ...(item.offices ?? []).map((office) => office.location ?? office.name)],
            publishedAt: item.first_published,
            updatedAt: item.updated_at,
            url: item.absolute_url,
            requisitionId: item.requisition_id,
            language: item.language,
            description: htmlToText(item.content),
        }));
    },

    async ashby(slug) {
        const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`);
        if (!data?.jobs) return null;
        return data.jobs.filter((item) => item.isListed !== false).map((item) => {
            const pay = (item.compensation?.summaryComponents ?? []).find((part) => String(part.compensationType).toLowerCase() === 'salary');
            const shown = item.shouldDisplayCompensationOnJobPostings !== false;
            const salaryText = shown ? clean(item.compensation?.scrapeableCompensationSalarySummary) ?? clean(item.compensation?.compensationTierSummary) : null;
            return job('ashby', slug, {
                jobId: item.id,
                title: item.title,
                department: item.department,
                team: item.team,
                locations: [item.location, ...(item.secondaryLocations ?? []).map((place) => place.location)],
                country: item.address?.postalAddress?.addressCountry,
                workplaceType: workplace(item.workplaceType, item.isRemote),
                employmentType: item.employmentType,
                salary: shown && (pay || salaryText)
                    ? { min: pay?.minValue ?? null, max: pay?.maxValue ?? null, currency: pay?.currencyCode ?? null, interval: pay?.interval ?? null, text: salaryText }
                    : null,
                publishedAt: item.publishedAt,
                url: item.jobUrl,
                applyUrl: item.applyUrl,
                description: clean(item.descriptionPlain) ?? htmlToText(item.descriptionHtml),
            });
        });
    },

    async lever(slug) {
        // The EU instance has its own host; a company lives on one of the two.
        for (const host of ['api.lever.co', 'api.eu.lever.co']) {
            const data = await getJson(`https://${host}/v0/postings/${encodeURIComponent(slug)}?mode=json`);
            if (!Array.isArray(data)) continue;
            return data.map((item) => {
                const lists = (item.lists ?? []).map((list) => `${htmlToText(list.text)}\n${htmlToText(list.content)}`);
                const range = item.salaryRange;
                return job('lever', slug, {
                    jobId: item.id,
                    title: item.text,
                    department: item.categories?.department,
                    team: item.categories?.team,
                    locations: item.categories?.allLocations?.length ? item.categories.allLocations : [item.categories?.location],
                    country: item.country,
                    workplaceType: workplace(item.workplaceType),
                    employmentType: item.categories?.commitment,
                    salary: range || item.salaryDescriptionPlain
                        ? { min: range?.min ?? null, max: range?.max ?? null, currency: range?.currency ?? null, interval: range?.interval ?? null, text: clean(item.salaryDescriptionPlain) }
                        : null,
                    publishedAt: item.createdAt,
                    url: item.hostedUrl,
                    applyUrl: item.applyUrl,
                    description: [clean(item.descriptionPlain) ?? htmlToText(item.description), ...lists, clean(item.additionalPlain) ?? htmlToText(item.additional)].filter(Boolean).join('\n\n'),
                });
            });
        }
        return null;
    },

    async workable(slug) {
        const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`);
        if (!data?.jobs) return null;
        return data.jobs.map((item) => {
            const places = item.locations?.length ? item.locations : [item];
            return job('workable', slug, {
                jobId: item.shortcode,
                company: data.name,
                title: item.title,
                department: item.department,
                locations: places.map((place) => [place.city, place.region ?? place.state, place.country].filter(Boolean).join(', ')),
                country: item.country,
                workplaceType: item.telecommuting === true ? 'remote' : null,
                employmentType: item.employment_type,
                publishedAt: item.published_on ?? item.created_at,
                url: item.url ?? item.shortlink,
                applyUrl: item.application_url,
                requisitionId: item.code,
                description: htmlToText(item.description),
            });
        });
    },

    async smartrecruiters(slug, { maxJobs = Infinity, keep = () => true } = {}) {
        const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings`;
        const list = [];
        // The whole list is read: the filters below choose among all the open jobs, not among the first few.
        for (let offset = 0; ; offset += 100) {
            const page = await getJson(`${base}?limit=100&offset=${offset}`);
            if (!page?.content) return offset ? list : null;
            list.push(...page.content);
            if (page.content.length < 100) break;
        }
        // The platform answers 200 with an empty list for a name it does not know.
        if (!list.length) return null;
        const jobs = [];
        // Details hold the text of the ad; read a few at a time.
        // Large companies list thousands of jobs: filter on what the list already says before reading the details.
        const wanted = list.filter((item) => keep({
            id: `smartrecruiters:${slug}:${item.id}`,
            title: item.name ?? '',
            locations: [smartLocation(item.location ?? {})],
            workplaceType: item.location?.hybrid === true ? 'hybrid' : item.location?.remote === true ? 'remote' : null,
            publishedAt: isoDate(item.releasedDate),
            description: null,
        })).slice(0, maxJobs);
        for (let start = 0; start < wanted.length; start += 4) {
            const details = await Promise.all(wanted.slice(start, start + 4).map((item) => getJson(`${base}/${item.id}`).catch(() => null)));
            details.forEach((detail, index) => {
                const item = detail ?? wanted[start + index];
                const sections = item.jobAd?.sections ?? {};
                const text = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
                    .map((key) => sections[key]?.text ? `${sections[key].title ?? ''}\n${htmlToText(sections[key].text)}`.trim() : '')
                    .filter(Boolean)
                    .join('\n\n');
                const place = item.location ?? {};
                jobs.push(job('smartrecruiters', slug, {
                    jobId: item.id,
                    company: item.company?.name,
                    title: item.name,
                    department: item.department?.label,
                    team: item.function?.label,
                    locations: [smartLocation(place)],
                    country: place.country?.toUpperCase(),
                    workplaceType: place.hybrid === true ? 'hybrid' : place.remote === true ? 'remote' : null,
                    employmentType: item.typeOfEmployment?.label,
                    publishedAt: item.releasedDate,
                    url: item.postingUrl ?? `https://jobs.smartrecruiters.com/${slug}/${item.id}`,
                    applyUrl: item.applyUrl,
                    requisitionId: item.refNumber,
                    language: item.language?.code,
                    description: text,
                }));
            });
        }
        jobs.totalOpen = list.length;
        return jobs;
    },

    async recruitee(slug) {
        const data = await getJson(`https://${encodeURIComponent(slug)}.recruitee.com/api/offers`);
        if (!data?.offers) return null;
        return data.offers.map((item) => {
            const pay = item.salary;
            return job('recruitee', slug, {
                jobId: item.id ?? item.slug ?? item.careers_url,
                company: item.company_name,
                title: item.title,
                department: item.department,
                locations: item.locations?.length ? item.locations.map((place) => [place.city, place.state, place.country].filter(Boolean).join(', ')) : [item.location],
                country: item.country_code,
                workplaceType: item.hybrid === true ? 'hybrid' : item.remote === true ? 'remote' : null,
                employmentType: item.employment_type_code,
                salary: pay && (pay.min || pay.max) ? { min: Number(pay.min) || null, max: Number(pay.max) || null, currency: pay.currency ?? null, interval: pay.period ?? null, text: null } : null,
                publishedAt: item.published_at ?? item.created_at,
                updatedAt: item.updated_at,
                url: item.careers_url,
                applyUrl: item.careers_apply_url,
                description: [htmlToText(item.description), htmlToText(item.requirements)].filter(Boolean).join('\n\n'),
            });
        });
    },

    async personio(slug) {
        for (const domain of ['jobs.personio.de', 'jobs.personio.com']) {
            const { status, body } = await get(`https://${encodeURIComponent(slug)}.${domain}/xml`, { accept: 'application/xml' });
            if (status !== 200 || !body.includes('<workzag-jobs')) continue;
            const tag = (xml, name) => {
                const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
                if (!match) return null;
                return clean(decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')));
            };
            const positions = body.match(/<position>[\s\S]*?<\/position>/g) ?? [];
            return positions.map((xml) => {
                const parts = (xml.match(/<jobDescription>[\s\S]*?<\/jobDescription>/g) ?? [])
                    .map((part) => `${tag(part, 'name') ?? ''}\n${htmlToText(tag(part, 'value') ?? '')}`.trim())
                    .filter(Boolean);
                const offices = [tag(xml, 'office'), ...(xml.match(/<additionalOffices>[\s\S]*?<\/additionalOffices>/)?.[0].match(/<office>[\s\S]*?<\/office>/g) ?? []).map((office) => tag(office, 'office'))];
                const id = tag(xml, 'id');
                return job('personio', slug, {
                    jobId: id,
                    company: tag(xml, 'subcompany'),
                    title: tag(xml, 'name'),
                    department: tag(xml, 'department'),
                    locations: offices,
                    employmentType: [tag(xml, 'employmentType'), tag(xml, 'schedule')].filter(Boolean).join(', '),
                    publishedAt: tag(xml, 'createdAt'),
                    url: `https://${slug}.${domain}/job/${id}`,
                    description: parts.join('\n\n'),
                });
            });
        }
        return null;
    },

    // slug is "<tenant>.<wdN>/<site>", as in https://<tenant>.<wdN>.myworkdayjobs.com/<site>
    async workday(slug, { maxJobs = Infinity, keep = () => true } = {}) {
        const match = String(slug).match(/^([a-z0-9_-]+)\.(wd\d+)\/([^/?#]+)$/i);
        if (!match) return null;
        const [, tenant, shard, site] = match;
        const host = `https://${tenant}.${shard}.myworkdayjobs.com`;
        const api = `${host}/wday/cxs/${tenant}/${encodeURIComponent(site)}`;
        // The list comes 20 at a time and holds only title, path and a rough date. Workday limits how fast
        // a site may be read, so requests go one at a time and stop as soon as enough jobs are found.
        const jobs = [];
        let total = null;
        for (let offset = 0; (total === null || offset < total) && jobs.length < maxJobs; offset += 20) {
            const page = await workdayRequest(`${api}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText: '' });
            if (!page?.jobPostings) {
                if (!offset) return null;
                break;
            }
            if (total === null) total = Number(page.total) || 0;
            for (const item of page.jobPostings) {
                if (jobs.length >= maxJobs) break;
                if (!item.externalPath) continue;
                if (!keep({ title: item.title ?? '', locations: null, workplaceType: null, publishedAt: roughDate(item.postedOn), description: null })) continue;
                const detail = await workdayRequest(`${api}${item.externalPath}`).catch(() => null);
                const info = detail?.jobPostingInfo;
                if (!info) continue;
                const full = job('workday', slug, {
                    jobId: info.jobReqId ?? info.id ?? item.externalPath,
                    company: clean(detail.hiringOrganization?.name)?.replace(/^\d+\s+/, ''),
                    title: info.title ?? item.title,
                    locations: [info.location, ...(info.additionalLocations ?? [])],
                    country: info.country?.alpha2Code ?? info.jobRequisitionLocation?.country?.alpha2Code ?? info.country?.descriptor,
                    workplaceType: workplace(info.remoteType),
                    employmentType: info.timeType,
                    publishedAt: info.startDate ?? roughDate(item.postedOn),
                    url: info.externalUrl ?? `${host}/${site}${item.externalPath}`,
                    requisitionId: info.jobReqId,
                    description: htmlToText(info.jobDescription),
                });
                // Place and text filters can be applied only on the full job.
                if (keep(full)) jobs.push(full);
            }
            if (page.jobPostings.length < 20) break;
        }
        jobs.totalOpen = total ?? jobs.length;
        return jobs;
    },
};

/** "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago" to an approximate date. */
function roughDate(text, now = Date.now()) {
    const value = String(text ?? '').toLowerCase();
    let days = null;
    if (value.includes('today')) days = 0;
    else if (value.includes('yesterday')) days = 1;
    else {
        const match = value.match(/(\d+)\+?\s+day/);
        if (match) days = Number(match[1]);
    }
    return days === null ? null : new Date(now - days * 86400000).toISOString();
}

// Measured on 20 Nov 2026: one request every 3 seconds is accepted, faster ones are refused for about a minute.
const WORKDAY_GAP_MS = 3000;
let workdayLastCall = 0;

/** One paced request to a Workday career site: GET, or POST when a body is given. Waits when told to slow down. */
async function workdayRequest(url, body) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
        const wait = workdayLastCall + WORKDAY_GAP_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        workdayLastCall = Date.now();
        try {
            const response = await fetch(url, {
                method: body ? 'POST' : 'GET',
                headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (response.status === 429) {
                // The site asks to slow down: wait as long as it says, or a little over a minute.
                const seconds = Math.min(Number(response.headers.get('retry-after')) || 65, 120);
                lastError = new Error('Workday is limiting requests');
                await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
                continue;
            }
            if (response.status >= 500) {
                lastError = new Error(`HTTP ${response.status}`);
                await new Promise((resolve) => setTimeout(resolve, 2000));
                continue;
            }
            if (response.status !== 200) return null;
            return await response.json();
        } catch (error) {
            lastError = error;
        }
    }
    throw new Error(`${new URL(url).host}: ${lastError?.message ?? 'request failed'}. Try again later or with fewer Workday companies in one run.`);
}

const URL_PATTERNS = [
    [/^(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#&]+)/i, 'greenhouse'],
    [/^boards-api\.greenhouse\.io\/v1\/boards\/([^/?#]+)/i, 'greenhouse'],
    [/^jobs\.ashbyhq\.com\/([^/?#]+)/i, 'ashby'],
    [/^jobs\.(?:eu\.)?lever\.co\/([^/?#]+)/i, 'lever'],
    [/^apply\.workable\.com\/([^/?#]+)/i, 'workable'],
    [/^(?:jobs|careers)\.smartrecruiters\.com\/([^/?#]+)/i, 'smartrecruiters'],
    [/^([^./]+)\.recruitee\.com/i, 'recruitee'],
    [/^([^./]+)\.jobs\.personio\.(?:de|com)/i, 'personio'],
];

/**
 * Understands one line of the "companies" input.
 * Accepts a career page address, "platform:name", or a bare name to look up on every platform.
 * @returns {{ platform: string|null, slug: string, input: string } | { error: string, input: string }}
 */
export function parseCompany(line) {
    const input = String(line ?? '').trim();
    if (!input) return { error: 'Empty line.', input };
    const prefixed = input.match(/^([a-z]+)\s*:\s*([^/\s:][^\s]*)$/i);
    if (prefixed && PLATFORMS.includes(prefixed[1].toLowerCase())) return { platform: prefixed[1].toLowerCase(), slug: prefixed[2], input };
    if (/^https?:\/\//i.test(input) || /\.[a-z]{2,}\//i.test(input) || /\.(recruitee|personio|myworkdayjobs)\./i.test(input)) {
        const address = input.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
        const workdaySite = address.match(/^([a-z0-9_-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[a-z]{2}\/)?([^/?#]+)/i);
        // Workday is switched off: on 20 Nov 2026 its job detail pages answered curl but refused this
        // program's requests with a 429 block page whatever the pace. The reader stays for a later retry.
        if (/\.myworkdayjobs\.com/i.test(address) && process.env.ENABLE_WORKDAY !== 'on') return { error: 'Workday career sites are not supported yet.', input };
        if (workdaySite) return { platform: 'workday', slug: `${workdaySite[1]}.${workdaySite[2]}/${decodeURIComponent(workdaySite[3])}`, input };
        if (/\.myworkdayjobs\.com/i.test(address)) return { error: 'For Workday give the full address of the career site, for example https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite.', input };
        for (const [pattern, platform] of URL_PATTERNS) {
            const match = address.match(pattern);
            if (match) return { platform, slug: decodeURIComponent(match[1]), input };
        }
        return { error: `Address not recognised. Supported career pages: ${PLATFORMS.join(', ')}.`, input };
    }
    if (/^[\w.-]+$/.test(input)) return { platform: null, slug: input, input };
    return { error: 'Write a career page address, "platform:name", or the short name the company uses on its hiring platform.', input };
}

/**
 * Reads the open jobs of one company.
 * @returns {Promise<{ status: 'ok'|'not_found'|'error', platform?: string, guessed?: boolean, jobs?: object[], reason?: string }>}
 */
export async function readCompany({ platform, slug }, options = {}) {
    const candidates = platform ? [platform] : GUESSABLE;
    let lastError = null;
    for (const name of candidates) {
        try {
            const jobs = await readers[name](slug, options);
            // When the platform was not given, an empty board is not proof that this is the right company.
            if (jobs && (platform || (jobs.totalOpen ?? jobs.length))) return { status: 'ok', platform: name, guessed: !platform, jobs };
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) return { status: 'error', reason: lastError.message };
    return { status: 'not_found', reason: platform ? `No job board named "${slug}" on ${platform}.` : `No job board named "${slug}" found on ${GUESSABLE.join(', ')}.` };
}
