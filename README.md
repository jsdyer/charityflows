# Charity Flows

<!-- coolcode:guide -->
Find a charity by name or business number, compare its available fiscal periods and follow exact business-number matches in the gifts panel. The table and CSV show the 40 largest gift entries per period, while totals cover all matched gifts in the selected filing.
<!-- /coolcode:guide -->

[Open Charity Flows](https://coolcode.ca/charityflows/). Explore registered Canadian charities by name, business number, city, province, designation or recent reported revenue. Compare available fiscal periods, inspect qualified-donee gift values, and follow recipients where their reported charity business number exactly matches the index.

The Canada Revenue Agency supplies Identification, Financial data and Qualified donees CSVs in annual T3010 packages. This version imports the 2022–2024 packages. The build joins financial and gift rows on the donor business number, fiscal period ending date, and form ID. Reporting periods use the original dates. Financial metrics use CRA form lines 4700, 5100, 4200 and 4350. The gifts panel uses positive `Total Gifts` amounts and combines rows sharing an exact recipient account number. Other recipient rows remain separate. Counts and totals cover all matched gifts in the selected filing. The table and its CSV present the 40 largest entries per period. Fields for addresses, directors and non-qualified donees are outside the index. Filings are self-reported and names may change.

Run `python3 scripts/build.py`, then serve `dist/` over HTTP. Python’s standard library performs the build. Pass `--input-dir` containing the nine original CRA CSV downloads to rerun offline. The browser loads a compact gzip directory with a plain JSON fallback and fetches one of 128 detail shards on demand. Source download URLs and report coverage are listed in the generated manifest and the source datasets appear in the site footer.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada). This independent application is unaffiliated with the Government of Canada.

<!-- schedule-reliability -->
## Schedule reliability

Public GitHub repositories can have scheduled workflows disabled after 60 days of inactivity. A separate weekly [schedule guard](.github/workflows/schedule-guard.yml) calls GitHub's enable-workflow API for an explicit list of refresh workflows and itself. It can restore workflows disabled for inactivity, preserves manually disabled workflows, and runs independently of collection failures.

This is an interim mitigation, not a scheduling guarantee: GitHub does not document active-workflow renewal as a permanent exemption, and scheduled runs can be delayed or dropped. A scheduler on our own Linux server is the planned independent trigger. The guard does not collect data, create dummy commits, or change source/check timestamps; successful collection and published data freshness still need monitoring.
<!-- /schedule-reliability -->
