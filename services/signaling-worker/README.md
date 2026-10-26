# 🔬 Ishika Cloudflare Worker WebRTC Signaling Relay

Zero-cost ($0/month) WebRTC signaling coordination service deployed to Cloudflare Workers with Durable Objects.

## Architecture

* **Stateless Compute:** Cloudflare Edge Worker routes incoming WebSockets to the appropriate room.
* **Stateful Room Routing:** Cloudflare Durable Object (`SignalingRoom`) manages active connected peers for each tele-pathology room session.
* **Zero Video Relaying:** Only transient ~1KB SDP offers, answers, ICE candidates, and stage sync coordinates pass through this worker. Video streams strictly peer-to-peer between browsers via STUN (`stun:stun.l.google.com:19302`).
* **Cloudflare Free Tier:** 100,000 requests/day and 1,000,000 Durable Object invocations/month are 100% free ($0/month).

---

## 🚀 One-Command Deployment to Cloudflare

### Prerequisites
1. Free Cloudflare account at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Node.js 18+ installed

### Step 1: Login to Cloudflare CLI
```bash
npx wrangler login
```

### Step 2: Deploy Worker
From this directory:
```bash
cd services/signaling-worker
npx wrangler deploy
```

Once deployed, Cloudflare will output your public worker URL:
```text
https://ishika-signaling.ishika-core.workers.dev
```

### Step 3: Connect from Ishika Viewer
The viewer in `apps/viewer/src/App.tsx` is already configured with `wss://ishika-signaling.ishika-core.workers.dev` as the production default.

You can also pass it explicitly via query parameter:
```text
https://yourname.github.io/ishika-core/?signaling=wss://ishika-signaling.ishika-core.workers.dev&room=case-101
```

Or configure it in `apps/viewer/src/App.tsx`.
