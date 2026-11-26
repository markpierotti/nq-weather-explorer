# Deploying to Google Cloud Run

The app runs as one Cloud Run service built from the existing `Dockerfile`.
- **Storage:** a Cloud Storage bucket is mounted at `/app/data`, so push subscriptions and the forecast tracker's history survive restarts.
- **Scheduled work:** Cloud Run doesn't run background timers while idle. Cloud Scheduler calls two token-protected endpoints instead (`server/schedulerAuth.ts`).

| Piece | Service |
|---|---|
| App (Express + React) | Cloud Run, `australia-southeast1` (Sydney), 0–1 instances |
| Server-only keys | Secret Manager (never in the image or the repo) |
| `DATA_DIR` (push state, tracker history) | Cloud Storage bucket mounted as a volume |
| Push poll (every 5 min), tracker (hourly) | Cloud Scheduler → `POST /api/push/poll`, `POST /api/tracker/run` |
| AI grounding check | the service account (metadata-server token), no key file |

`max-instances=1` keeps a single writer on the mounted bucket and one in-memory cache/rate limiter.

## One-time setup

```bash
PROJECT=gen-lang-client-0366527978        # "NQ Weather Explorer"
REGION=australia-southeast1
SA=nq-weather-run@$PROJECT.iam.gserviceaccount.com
BUCKET=nq-weather-explorer-data-161876250884

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com --project=$PROJECT

gcloud storage buckets create gs://$BUCKET --project=$PROJECT --location=$REGION \
  --uniform-bucket-level-access --public-access-prevention

gcloud iam service-accounts create nq-weather-run --project=$PROJECT --display-name="NQ Weather Explorer (Cloud Run)"
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectUser
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/discoveryengine.viewer --condition=None

# Secrets: values come from .env (or are generated); none are echoed.
for NAME in GOOGLE_WEATHER_API_KEY GEMINI_API_KEY QLDTRAFFIC_API_KEY VAPID_PRIVATE_KEY SILO_EMAIL; do
  grep -E "^$NAME=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' | tr -d '\n' |
    gcloud secrets create $NAME --project=$PROJECT --replication-policy=user-managed --locations=$REGION --data-file=-
done
openssl rand -hex 24 | tr -d '\n' |
  gcloud secrets create SCHEDULER_TOKEN --project=$PROJECT --replication-policy=user-managed --locations=$REGION --data-file=-
for NAME in GOOGLE_WEATHER_API_KEY GEMINI_API_KEY QLDTRAFFIC_API_KEY VAPID_PRIVATE_KEY SILO_EMAIL SCHEDULER_TOKEN; do
  gcloud secrets add-iam-policy-binding $NAME --project=$PROJECT --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
```

## Deploy (and redeploy after changes)

```bash
gcloud run deploy nq-weather --project=$PROJECT --region=$REGION --source=. \
  --service-account=$SA --allow-unauthenticated \
  --cpu=1 --memory=512Mi --min-instances=0 --max-instances=1 \
  --set-env-vars="VITE_GOOGLE_MAPS_API_KEY=<public browser key>,VAPID_PUBLIC_KEY=<public>,DATA_DIR=/app/data,TRACKER_SCHEDULER=off,PUSH_POLLER=off,ENABLE_CHECK_GROUNDING=true,GCP_PROJECT_ID=$PROJECT,TRUST_PROXY=1" \
  --set-secrets="GOOGLE_WEATHER_API_KEY=GOOGLE_WEATHER_API_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,QLDTRAFFIC_API_KEY=QLDTRAFFIC_API_KEY:latest,VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest,SILO_EMAIL=SILO_EMAIL:latest,SCHEDULER_TOKEN=SCHEDULER_TOKEN:latest" \
  --add-volume="name=data,type=cloud-storage,bucket=$BUCKET,mount-options=uid=1000;gid=1000" \
  --add-volume-mount="volume=data,mount-path=/app/data"
```

## Schedules

```bash
URL=$(gcloud run services describe nq-weather --project=$PROJECT --region=$REGION --format='value(status.url)')
TOKEN=$(gcloud secrets versions access latest --secret=SCHEDULER_TOKEN --project=$PROJECT)
gcloud scheduler jobs create http nq-weather-push-poll --project=$PROJECT --location=$REGION \
  --schedule="*/5 * * * *" --uri="$URL/api/push/poll" --http-method=POST --headers="X-Scheduler-Token=$TOKEN"
gcloud scheduler jobs create http nq-weather-tracker --project=$PROJECT --location=$REGION \
  --schedule="7 * * * *" --time-zone="Australia/Brisbane" --uri="$URL/api/tracker/run" --http-method=POST \
  --headers="X-Scheduler-Token=$TOKEN"
```

## After the first deploy
- **Browser Maps key:** add the `*.run.app` URL (and later your domain) to its HTTP-referrer restrictions, or the map won't load.
- **Server key (`GOOGLE_WEATHER_API_KEY`):** if it's restricted to the VPS's IP address, Cloud Run's changing IPs will be refused. Use API restrictions instead.
- **Moving push subscriptions:** copy the VPS's `data/push-state.json` into the bucket (`gcloud storage cp`). The tracker backfills its own history on the first run.
- **Switching your domain:** keep the VPS running until the Cloud Run URL is checked, then point the domain at Cloud Run (domain mapping or a load balancer).

## Cost (rough, Sydney)
- **Cloud Run:** request-based billing with scale to zero. The 5-minute scheduler pings are short, so usage normally stays within the free allowance.
- **Scheduler:** 2 jobs, inside the 3 free jobs per billing account.
- **Secret Manager:** 6 secrets, inside the free allowance.
- **Storage and Artifact Registry:** cents per month.
- **Expect about $0–3/month** at current traffic.
