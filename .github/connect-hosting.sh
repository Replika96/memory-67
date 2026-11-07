#!/usr/bin/env bash
# Run once in Google Cloud Shell, signed in as the owner of Memory.
(
set -euo pipefail
project=memory-67
number=411496341991
repo=Replika96/memory-67
pool=flashcards
account=flashcards-hosting
email="$account@$project.iam.gserviceaccount.com"
condition="assertion.repository=='$repo' && assertion.ref=='refs/heads/main' && assertion.workflow_ref=='$repo/.github/workflows/publish.yml@refs/heads/main'"

test "$(gcloud projects describe "$project" --format='value(projectNumber)')" = "$number"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com firebasehosting.googleapis.com firebase.googleapis.com --project="$project"
if ! gcloud iam service-accounts describe "$email" --project="$project" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$account" --project="$project" --display-name='Memory Hosting publisher'
fi
if ! gcloud iam workload-identity-pools describe "$pool" --project="$project" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$pool" --project="$project" --location=global --display-name='Memory GitHub deployment'
fi
if ! gcloud iam workload-identity-pools providers describe github --project="$project" --location=global --workload-identity-pool="$pool" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc github --project="$project" --location=global \
    --workload-identity-pool="$pool" --display-name='Memory main branch' \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
    --attribute-condition="$condition"
else
  configured=$(gcloud iam workload-identity-pools providers describe github --project="$project" --location=global --workload-identity-pool="$pool" --format='value(attributeCondition)')
  if [[ "$configured" != "$condition" ]]; then
    echo 'Existing identity provider has different access rules. Review before connecting.' >&2
    exit 1
  fi
fi
gcloud iam service-accounts add-iam-policy-binding "$email" --project="$project" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$number/locations/global/workloadIdentityPools/$pool/attribute.repository/$repo" >/dev/null
for role in roles/firebasehosting.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$email" --role="$role" --condition=None >/dev/null
done
echo 'Memory Hosting connected. You can now run Publish flashcards in GitHub Actions.'
)
