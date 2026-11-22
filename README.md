# GIT G.O.A.T.

Evidence-led, read-only GitHub repository readiness scanning with step-by-step remediation guidance.

## Development

Requirements: Node.js 22 and pnpm 11. Run `pnpm install`, then run the API and frontend in separate terminals: `pnpm api` and `pnpm dev`. Preview uses port 3000 for the Vite app and proxies `/api` to the API at port 3001.

The public read-only scanner needs no credential for public repositories. It requires outbound internet access to GitHub. It inventories the Git tree at a pinned commit and inspects bounded text files only; see report exclusions and scope notes. It never runs repository code.

## Guided remediation

Each of the 25 built-in repository checks has a finding-specific multiple-choice question and concrete remediation checklist. Future/unknown findings receive a safe general checklist. Users can tick items as a personal on-page checklist; those ticks are not persisted or verified. Recorded choices are saved as volatile session data without MongoDB, or in MongoDB with `MONGO_URL`. A scope exclusion needs at least 10 characters of rationale and is added to the scan report. Choices and checklists do not edit GitHub or run code.

## Optional MongoDB

Set `MONGO_URL` in the server environment to persist scans and guided choices in the `git_goat` database. The app uses `scans` and `guided_choices` collections with unique/search/retention indexes. Without MongoDB, records are session-only and will be lost when the server restarts. Do not enter the URI into frontend code or commit it.

## Container build (not yet tested)

`docker build -t git-goat .` builds the client and service. Run with `docker run --rm -p 3000:3000 -e MONGO_URL='<your MongoDB URI>' git-goat` when MongoDB is available. The Docker container exposes the web app/API on port 3000; health endpoint is `/api/v1/health`. This container is for app hosting only and is **not** the repository execution sandbox.

## Current capability gates

Private-repository OAuth and GitHub write/PR actions are not enabled. No GitHub OAuth application, secure app login/authorization, approval workflow for writes, or secure token store is implemented. Isolated repository execution is disabled: ordinary app hosting is not a sandbox. No tests/builds from scanned repositories are run.

The toolchain available during implementation did not include the Bit CLI. No Bit component or `bit use` / `bit run` compatibility is claimed. Configure and verify it in an environment with the actual required Bit Platform version before relying on those commands.

## Report semantics

Scores use the fixed severity weights from the brief and count only `VERIFIED_COMPLETE` findings as complete. Presence checks do not establish operational effectiveness. Branch protection, CI outcome inspection, OSV dependency advisories, full archive retrieval, live test results and repository-history secret scanning are not verified by this implementation. See `BUILD_REPORT.md` for exact evidence, test results and blockers.
