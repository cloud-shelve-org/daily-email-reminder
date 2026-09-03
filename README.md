# Daily Email Reminder

A small personal web app that sends a reminder email every day until the recipient replies.

## Architecture

- **GitHub Pages** — static web UI.
- **Google Apps Script** — API endpoint, daily trigger, reply detection and Gmail/Drive integration.
- **Gmail** — sends the reminder and receives the reply.
- **Google Drive** — temporarily stores the optional image attachment.

## Current flow

1. Enter recipient, subject, body, optional image and daily send hour.
2. Click **Start reminder**.
3. Apps Script creates a unique tracking ID and a daily time-driven trigger.
4. The trigger checks the reminder thread for a reply from the recipient.
5. If no reply is found, Gmail sends the reminder.
6. Once a reply is detected, the trigger is removed and the cycle is marked **Completed**.
7. Clicking Start after completion creates a new tracking ID and starts a fresh cycle.

## Google Apps Script setup

1. Open [script.google.com](https://script.google.com/) and create a new standalone Apps Script project.
2. Copy the contents of `apps-script/Code.gs` into the Apps Script editor.
3. Set the project timezone to **Asia/Kolkata** (or your preferred timezone).
4. Run `setupCheck()` once and approve Gmail/Drive permissions.
5. Deploy → New deployment → Web app.
6. Execute as **Me**.
7. Set access to the option that allows your GitHub Pages browser request to reach the web app (for a personal app this is normally **Anyone**).
8. Copy the deployment URL.
9. Put that URL into `SCRIPT_URL` in `app.js`.
10. Commit the change and let GitHub Pages deploy.

### Security note

The Apps Script web-app URL is public and the browser frontend is public. This MVP is intended for personal use, not for a multi-user/public service. Do not put Gmail credentials or other private secrets in `app.js`. The Apps Script runs with your Google authorization after you approve the required scopes.

## GitHub Pages

The repository contains a GitHub Actions workflow at `.github/workflows/deploy-pages.yml`. In the repository settings, enable **Pages** using **GitHub Actions** as the source if GitHub has not enabled it automatically.

## Important behavior

- The optional attachment is limited to 2 MB by the UI/backend.
- The image is copied to a dedicated Drive folder and trashed when the reminder completes or is stopped.
- The backend adds a unique reminder ID to each email so the sent message can be associated with its Gmail thread.
- Apps Script time-driven triggers are scheduled by hour and may execute within the normal Apps Script scheduling window rather than at an exact minute.
