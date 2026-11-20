# Company Career Jobs, with AI brief

Get the open jobs of the companies **you choose**, read live from each company's own career page on its hiring platform: **Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee and Personio**.

No job board in the middle and no database that may be days old: every run asks the platform what is open right now. These platforms publish their job boards on public addresses made to be read by programs, so the data is complete and the run is fast: a company with several hundred jobs takes a few seconds.

Turn on the **AI brief** and each ad also comes back as a short structured card: level, minimum years of experience, must-haves and nice-to-haves, technologies, pay as stated, remote rules, languages, visa sponsorship, benefits and conditions.

## Who uses it

- **Sales and market research**: hiring is a signal. A company opening five data-engineering roles is buying data tools.
- **Recruiters and talent teams**: watch what competitors and clients are hiring for.
- **Job seekers**: follow a shortlist of companies and get only the new roles that match.
- **Job boards and AI agents**: clean, structured ads straight from the source.

## How to list the companies

One company per line, in any of these forms:

| Form | Example |
|---|---|
| Career page address (best) | `https://jobs.ashbyhq.com/ramp` |
| | `https://boards.greenhouse.io/stripe` |
| | `https://jobs.lever.co/palantir` |
| | `https://apply.workable.com/huggingface` |
| | `https://jobs.smartrecruiters.com/BoschGroup` |
| | `https://bunq.recruitee.com` |
| | `https://acme.jobs.personio.de` |
| Platform and name | `greenhouse:stripe` |
| Short name only | `stripe` |

With the short name only, the Actor looks it up on every platform and uses the first board that has open jobs. Two companies can use the same short name on different platforms, so each job says `platformGuessed: true` in that case: check the first result, and give the address if it is the wrong company.

To find the address, open the company's careers page and click any job: the address of the ad shows the platform and the name.

## Filters

- Job title contains any of / does not contain
- Location contains any of (as the company writes it: `Berlin`, `Germany`, `EMEA`, `Remote`)
- Remote jobs only
- Published in the last N days
- Ad text contains any of (for example `Kubernetes`, `Salesforce`)
- Maximum jobs per company and in total

## Monitor: only what is new since the last run

Turn on **Only jobs not delivered before** and put the Actor on a schedule. Each run saves only the jobs that earlier runs have not saved yet, so you get just the new openings and you pay only for those. A run with nothing new saves nothing.

- The first run saves every job that matches your filters: that is the starting point.
- A job counts as delivered only once it is saved. Jobs left out by a limit come in the next run.
- Give a **Monitor name** to keep separate memories, for example one per client or per search. Runs with the same name share one memory.
- The memory is a record in the key-value store `company-career-jobs-seen` of your own account. Delete the record to start again. A job that has not been open for 180 days is forgotten.

## What you get

**For every job**

- Title, department and team
- All locations, country, workplace type (remote, hybrid, onsite) when the platform gives it
- Employment type
- Pay range with currency and period, when the company publishes it on the platform
- Publication date, and last update when the platform gives it
- Link to the ad and to the application form
- The full text of the ad, as plain text

Not every platform gives every field: a field the platform does not publish is `null`, never guessed.

**With "AI brief" turned on**

- **Summary**: what the person will do, in two sentences
- **Level**: only when the ad names one (`senior`, `staff_or_principal`, `lead`, `manager`...); otherwise `not_stated`
- **Minimum years of experience**, when the ad gives a number
- **Must-haves** and **nice-to-haves**, kept apart
- **Technologies**: named tools and software mentioned in the ad
- **Pay as stated** in the ad, with the ranges per location
- **Workplace** and its limits: countries or time zones allowed, days in the office
- **Spoken languages**, **education**, **visa sponsorship**
- **Benefits** and **conditions**: clearance, work authorisation, travel, on-call, contract term, deadlines

Every brief is written and then audited item by item against the ad by the model itself; `aiBrief.audited` tells you the check was done. The model is told to report only what the ad states: a level is never derived from years of experience, pay is never estimated. It is still an automatic reading: check the ad before you rely on a detail.

The brief can be written in English, Italian, German, French, Spanish, Polish, Dutch or Portuguese, whatever the language of the ad.

## Companies that could not be read

The run does not stop when one name is wrong. The record `SUMMARY` in the key-value store has one row per company of your input: platform found, open jobs, jobs saved, or the reason it could not be read.

## Example

Input:

```json
{
    "companies": ["https://jobs.ashbyhq.com/ramp", "https://boards.greenhouse.io/stripe"],
    "titleKeywords": ["engineer"],
    "locationKeywords": ["remote", "new york"],
    "postedInLastDays": 14,
    "maxItems": 50,
    "aiBrief": true
}
```

One item of the output, shortened:

```json
{
    "id": "ashby:ramp:34413f8d-26bf-4bbc-8ade-eb309a0e2245",
    "platform": "ashby",
    "companySlug": "ramp",
    "title": "Software Engineer, Security, Cloud",
    "department": "Engineering",
    "team": "Backend",
    "locations": ["New York, NY (HQ)", "Remote (Canada)", "Remote (US)", "Miami, FL"],
    "workplaceType": "hybrid",
    "employmentType": "FullTime",
    "salary": { "min": 211400, "max": 290600, "currency": "USD", "interval": "1 YEAR", "text": "$211.4K - $290.6K" },
    "publishedAt": "2026-04-07T17:12:35.753Z",
    "url": "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245",
    "description": "ABOUT RAMP ...",
    "aiBrief": { "status": "ok", "brief": { "summary": "...", "seniority": "not_stated", "mustHave": ["..."], "audited": true } }
}
```

## Pricing

You pay per job saved, plus a separate price per AI brief only when you turn it on. Platform usage is included. Jobs removed by your filters are not charged. Set "Maximum jobs in total" and "Maximum briefs" to cap a run.

## Limits

- Companies on other hiring platforms (Workday, iCIMS, SuccessFactors, Teamtailor and others) are not covered yet. Open an issue with the career page you need.
- The data is what the company publishes on its board: if an ad has no pay or no workplace type there, the field is empty.
- The Actor reads only public job boards. It does not log in anywhere and does not collect data about candidates or employees.

## Support

Found a wrong field or a board that should be read and is not? Open an issue on this page with the company address: it is usually answered within two working days.
