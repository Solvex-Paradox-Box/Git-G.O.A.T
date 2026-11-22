# GIT G.O.A.T.

Evidence-led, read-only GitHub repository readiness scanning with step-by-step remediation guidance.

## Development

Requirements: Node.js 22 and pnpm 11. Run `pnpm install`, then run the API and frontend in separate terminals: `pnpm api` and `pnpm dev`. Preview uses port 3000 for the Vite app and proxies `/api` to the API at port 3001.

The public read-only scanner needs no credential for public repositories. It requires outbound internet access to GitHub. It inventories the Git tree at a pinned commit and inspects bounded text files only; see its report exclusions and scope notes. It never runs repository code.

## Optional MongoDB

Set `MONGO_URL` in the server environment to persist scans and guided choices in the `git_goat` database. The app uses `scans` and `guided_choices` collections with unique/search/retention indexes. Without MongoDB, records are session-only and will be lost when the server restarts. Do not enter the URI into frontend code or commit it.

## Current capability gates

Private-repository OAuth and GitHub write/PR actions are not enabled until a GitHub OAuth application, protected secrets, authorization/session controls, approval UX and API paths are implemented and tested. Isolated repository execution is disabled: ordinary app hosting is not a sandbox. No tests/builds from scanned repositories are run.

The toolchain available during implementation did not include the Bit CLI. No Bit component or `bit use` / `bit run` compatibility is claimed. Configure and verify it in an environment with the actual required Bit Platform version before relying on those commands.

## Report semantics

Scores use the fixed severity weights from the brief and count only `VERIFIED_COMPLETE` findings as complete. Presence checks do not establish operational effectiveness. Branch protection, live dependency advisories, workflow execution, test results and repository history secret scanning are not verified by this limited public scan. Exact commit, evidence, scan limits, exclusions, persistence status and blocked features are included in the report.
