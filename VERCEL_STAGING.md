# Vercel staging deployment

The GitHub Actions workflow runs validation first. It can deploy non-`main` branch pushes and manual runs to a Vercel **Preview** deployment, not Production. Automatic non-`main` deployments are disabled until the repository variable `VERCEL_STAGING_ENABLED` is set to the exact value `true`. A manual dispatch can enable staging for that single run with the `VERCEL_STAGING_ENABLED` boolean input, without enabling future automatic deployments.

Before enabling it, create or select the Vercel project for this app and add these secrets to the GitHub Actions environment named `staging`:

- `VERCEL_TOKEN`: a Vercel access token scoped to this project where possible.
- `VERCEL_ORG_ID`: the owning Vercel account/team ID.
- `VERCEL_PROJECT_ID`: the Vercel project ID.

The job uses `vercel pull --environment=preview`, `vercel build`, and `vercel deploy --prebuilt`; it never invokes a Production deploy. Do not paste secret values into source control, issues, or chat. Configure any app runtime values such as `MONGO_URL` in the Vercel Preview environment itself; the GitHub workflow secrets are only for the deployment CLI.

`vercel.json` configures the frontend output and includes it in the Express function bundle for the app's SPA fallback. Vercel serves the Vite build output as static assets and invokes the exported Express application for application routes. The Express app does not start a persistent listener when Vercel sets its runtime environment variable; the existing local API command still starts the listener for local development.

The deployment remains unverified until the three GitHub environment secrets are configured, the Vercel project is correctly linked by those identifiers, and a successful Preview deployment is observed. Without `MONGO_URL` in Vercel's Preview environment, scan persistence remains volatile.
