// Turns a job ad into a short structured brief: level, requirements, pay, remote policy, conditions.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

// Model chosen by the actor owner for cost per brief; override with BRIEF_MODEL.
export const DEFAULT_MODEL = 'claude-haiku-5-5';

const LANGUAGES = { en: 'English', it: 'Italian', de: 'German', fr: 'French', es: 'Spanish', pl: 'Polish', nl: 'Dutch', pt: 'Portuguese' };

// Ads longer than this are cut; the brief then says so.
const MAX_AD_CHARS = 24000;

export const BriefSchema = z.object({
    summary: z.string().describe('Two plain sentences: what the person will do and in which team or product. No company boilerplate.'),
    seniority: z.enum(['intern', 'junior', 'mid', 'senior', 'staff_or_principal', 'lead', 'manager', 'director', 'executive', 'not_stated'])
        .describe('The level the ad itself names, in the title or in the text (for example "Senior", "Staff", "Head of", "Intern"). "not_stated" when the ad names no level: never derive it from years of experience or from the salary.'),
    minYearsExperience: z.number().nullable().describe('The minimum years of experience the ad asks for, as a number ("5+ years" is 5, "3-5 years" is 3). null when the ad states no number.'),
    workplace: z.enum(['remote', 'hybrid', 'onsite', 'not_stated']).describe('Where the work is done according to the ad or the platform data. "not_stated" when neither says.'),
    workplaceNotes: z.string().describe('Limits and details the ad states about the workplace: countries or time zones allowed for remote work, days in the office, relocation. Empty string if none.'),
    salaryStated: z.string().describe('The pay exactly as the ad or the platform data states it, with currency and period, including ranges per location. Empty string if no pay is stated. Never estimate.'),
    mustHave: z.array(z.string()).describe('Requirements the ad presents as required. One short item each, in the ad\'s own terms.'),
    niceToHave: z.array(z.string()).describe('Requirements the ad presents as preferred, a plus or a bonus. Empty if none.'),
    technologies: z.array(z.string()).describe('Named tools, programming languages, frameworks, platforms and software the ad mentions for the job, each as written. Empty if none.'),
    spokenLanguages: z.array(z.string()).describe('Human languages the ad requires or prefers, with the level if stated (for example "German, fluent"). Empty if none stated.'),
    education: z.string().describe('The degree or qualification the ad asks for, as stated. Empty string if none.'),
    visaSponsorship: z.enum(['offered', 'not_offered', 'not_stated']).describe('"offered" or "not_offered" only when the ad says so explicitly about visa or work-permit sponsorship.'),
    benefits: z.array(z.string()).describe('Concrete benefits the ad lists (equity, bonus, days off, insurance, budget). Short items. Empty if none.'),
    conditions: z.array(z.string()).describe('Conditions a candidate must know before applying: security clearance, citizenship or work authorisation, travel share, on-call or shift work, fixed-term contract, application deadline, background checks. Empty if none stated.'),
});

const SYSTEM = `You write briefs of job ads for people who screen many ads: job seekers, recruiters, and sales teams that read hiring as a signal.

The job data you receive is your only source:
- Report only what the ad or the platform data states. If something is not stated, use "not_stated", null, an empty string or an empty list as the field asks. Never fill a gap with what is usual for this kind of job or company.
- Keep every figure, range, currency, date and product name exactly as given. Do not convert currencies or compute yearly from hourly pay.
- Required and preferred are different lists: an item goes under mustHave only if the ad presents it as required. When the ad gives one list without saying which, put it under mustHave.
- Do not turn duties into requirements: what the person will do is not something they must already have.
- Technologies are only named tools, software and programming languages the job works with: not skills ("communication"), not fields ("machine learning" is a field, "PyTorch" is a technology), not methods, standards or certifications ("TOGAF", "SAFe", "Scrum", "ISO 27001"), not the company's internal training systems.
- Workplace: when the platform data gives a workplace type, that is the value, unless a full sentence of the ad says otherwise. Hashtags and recruiter tags such as "#LI-Onsite" or "#LI-Remote" are not sentences of the ad: never set the value from them. With no platform value and no sentence about where the work is done, the value is "not_stated": a street address or opening hours do not make a job onsite. Any disagreement between platform data, locations (for example "Remote (US)" next to a hybrid flag), tags and ad text goes in workplaceNotes.
- When the ad asks for several numbers of years for different things, minYearsExperience is the largest among the required ones.
- When the ad has a list of what it requires and a second list of what it values, prefers or would love to see, the second list goes under niceToHave in full.
- Conditions are constraints of the job itself. How to apply (cover letter, referral, questions of the form), the employment type and optional programmes offered to other roles are not conditions: leave them out. An application deadline is a condition.
- Benefits are only items the ad lists as benefits or perks. A general sentence about competitive pay, equity and benefits is not a list. Keep the country or office a benefit is limited to.
- The summary is about this job only: no product, team or programme the ad mentions only for other roles.
- Translate every common word of the ad into the brief's language, including words that look like words of another language (Dutch "brand" is fire); keep only names untranslated. Commuting costs are not business travel.
- Equal-opportunity statements, privacy notices and descriptions of the company are not requirements, benefits or conditions.
- Write free-text fields in the language requested, translating faithfully; keep product names, job titles and legal terms as written.
- Write for a reader who never sees the data: never mention field names.
- Be short and concrete. No advice on whether to apply, no marketing language.`;

const AUDIT_STEPS = `You are given the job data and a first draft of its brief. Audit the draft item by item against the ad and return the corrected brief in full. Keep what is right as it is; fix or remove what the ad contradicts or does not support; add what is missing.

Go through these points one by one:
1. Read the whole ad again, including the last paragraphs, where pay, location limits and conditions are often written.
2. seniority is a level the ad names in its title or text. If the draft derived it from years of experience, pay or duties, set "not_stated".
3. minYearsExperience is a number written in the ad; when the ad asks for several numbers for different things, it is the largest among the required ones.
4. salaryStated copies every pay figure the ad or the platform data gives, with currency, period and the location each range applies to. Empty if none. Nothing estimated.
5. workplace is the platform's workplace type when it gives one, changed only on a full sentence of the ad that says otherwise, never on a hashtag or tag such as "#LI-Onsite". With no platform value and no such sentence it is "not_stated". workplaceNotes states every disagreement between platform data, listed locations, tags and ad text, and the days in the office or allowed countries the ad gives.
6. Each mustHave item is presented as required in the ad; each niceToHave item as preferred. No duty is listed as a requirement. Go through the ad's requirement list line by line: every line is in the brief, with its examples. A second list of what the company values or prefers is under niceToHave in full.
7. technologies holds only named tools, software and programming languages written in the ad for this job, each once, as written, including the ones named in the duties. No methods, standards, certifications or internal training systems.
8. visaSponsorship is "offered" or "not_offered" only on an explicit sentence about sponsorship; a sentence about work authorisation or citizenship goes under conditions instead.
9. conditions lists every clearance, citizenship or work-authorisation rule, travel share, on-call or shift duty, contract term, deadline and background check the ad states for this job. Remove application instructions (cover letter, referral, form answers), the employment type, optional programmes for other roles and anything from boilerplate.
10. benefits are concrete items the ad lists as benefits, each with the country or office it is limited to, not general claims ("great culture", "competitive compensation and equity").
11. Figures, names and dates are exactly those of the ad. The summary speaks only of this job. If the ad text was cut off, the summary says so.
12. Translation: every common word is in the brief's language and means what the ad means; only names stay as written.`;

const REMOTE_NOTE = {
    English: 'The platform marks this job as {type}, but its locations include: {places}. Check with the company which applies.',
    Italian: 'La piattaforma indica questo lavoro come {type}, ma tra le sedi compare: {places}. Verificare con la società quale vale.',
    German: 'Die Plattform kennzeichnet diese Stelle als {type}, unter den Standorten steht jedoch: {places}. Bitte beim Unternehmen klären, was gilt.',
    French: 'La plateforme indique ce poste comme {type}, mais ses lieux incluent : {places}. À vérifier auprès de la société.',
    Spanish: 'La plataforma marca este puesto como {type}, pero entre sus ubicaciones figura: {places}. Conviene confirmarlo con la empresa.',
    Polish: 'Platforma oznacza tę ofertę jako {type}, ale wśród lokalizacji jest: {places}. Warto potwierdzić w firmie.',
    Dutch: 'Het platform markeert deze vacature als {type}, maar bij de locaties staat: {places}. Vraag bij het bedrijf na wat geldt.',
    Portuguese: 'A plataforma indica esta vaga como {type}, mas entre os locais consta: {places}. Convém confirmar com a empresa.',
};

export class BriefWriter {
    constructor({ model = process.env.BRIEF_MODEL || DEFAULT_MODEL, language = 'en', client = new Anthropic(), audit = process.env.BRIEF_AUDIT !== 'off' } = {}) {
        this.audit = audit;
        this.model = model;
        this.language = LANGUAGES[language] ?? 'English';
        this.client = client;
        this.usage = { written: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
        this.auditFailures = 0;
        this.lastAuditFailure = null;
    }

    /** One structured request. Returns { brief } or { status, reason }. */
    async ask(request, effort) {
        let message;
        try {
            message = await this.client.messages
                .stream({
                    model: this.model,
                    // Thinking counts against this limit, so it is set well above the size of a brief.
                    max_tokens: 16000,
                    system: SYSTEM,
                    output_config: { effort, format: zodOutputFormat(BriefSchema) },
                    messages: [{ role: 'user', content: request }],
                })
                .finalMessage();
        } catch (error) {
            if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
                // Nothing will work until the key is fixed: stop the run instead of failing every job.
                error.fatal = true;
                throw error;
            }
            if (error instanceof Anthropic.RateLimitError) return { status: 'model_busy', reason: 'Rate limit reached, try again later.' };
            if (error instanceof Anthropic.BadRequestError) return { status: 'model_rejected', reason: error.message.slice(0, 300) };
            if (error instanceof Anthropic.APIError) return { status: 'model_error', reason: `API error ${error.status}` };
            return { status: 'model_error', reason: error.message };
        }

        this.usage.calls++;
        this.usage.inputTokens += message.usage?.input_tokens ?? 0;
        this.usage.outputTokens += message.usage?.output_tokens ?? 0;

        if (message.stop_reason === 'refusal') return { status: 'model_refused', reason: message.stop_details?.category ?? null };
        if (message.stop_reason === 'max_tokens') return { status: 'model_error', reason: 'The answer was cut off.' };

        const text = message.content.find((block) => block.type === 'text')?.text;
        try {
            return { brief: BriefSchema.parse(JSON.parse(text)) };
        } catch (error) {
            return { status: 'model_error', reason: `Answer not in the expected format: ${error.message.slice(0, 200)}` };
        }
    }

    /** @returns {Promise<{status: string, reason?: string, brief?: object}>} */
    async write(job) {
        if (!job.description || job.description.length < 200) return { status: 'no_text', reason: 'The ad has no text to read.' };
        const cut = job.description.length > MAX_AD_CHARS;
        const data = {
            title: job.title,
            company: job.company ?? job.companySlug,
            locations: job.locations,
            workplaceTypeOnPlatform: job.workplaceType,
            employmentType: job.employmentType,
            salaryOnPlatform: job.salary,
            adText: cut ? job.description.slice(0, MAX_AD_CHARS) : job.description,
            adTextCutOff: cut,
        };
        const request = `Write the brief in ${this.language}.

<job>
${JSON.stringify(data)}
</job>`;

        const draft = await this.ask(request, 'low');
        if (!draft.brief) return draft;

        // The draft is checked once against the ad by the same model; if the check fails, the draft is kept.
        let { brief } = draft;
        let audited = false;
        if (this.audit) {
            const second = await this.ask(`${request}

First draft:
${JSON.stringify(brief)}

${AUDIT_STEPS}`, 'medium');
            if (second.brief) {
                brief = second.brief;
                audited = true;
            } else {
                this.auditFailures++;
                this.lastAuditFailure = `${second.status}: ${second.reason ?? ''}`;
            }
        }
        this.usage.written++;
        // Written by code, not by the model: a job flagged hybrid or onsite that also lists a remote location.
        const remotePlaces = (job.locations ?? []).filter((place) => String(place).toLowerCase().includes('remote'));
        if (['hybrid', 'onsite'].includes(job.workplaceType) && remotePlaces.length) {
            const note = (REMOTE_NOTE[this.language] ?? REMOTE_NOTE.English).replace('{type}', job.workplaceType).replace('{places}', remotePlaces.join('; '));
            brief = { ...brief, workplaceNotes: [brief.workplaceNotes, note].filter(Boolean).join(' ') };
        }
        return { status: 'ok', brief: { ...brief, language: this.language, model: this.model, audited } };
    }
}
