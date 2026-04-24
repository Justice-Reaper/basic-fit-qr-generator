# BasicShare

Access your BasicFit QR code from any browser — no app needed.

## Features

- Generate your BasicFit entry QR code (refreshes every 5 seconds)
- Three login methods: OAuth, People ID, or manual entry
- Works on desktop and mobile
- Dark theme

## Login Methods

### 1. BasicFit OAuth
Sign in with your BasicFit account directly. 

### 2. People ID (easiest on mobile)
1. Log in at [my.basic-fit.com](https://my.basic-fit.com)
2. Go to **Profile → My personal data → Export my information (JSON)**
3. Copy the link — it contains your `peopleId`
4. Paste the link + enter your card number

### 3. Manual entry
Enter your card number and device ID directly if you already have them.

## Running locally

```bash
npm install
node server.js
```

Open [http://localhost:3000](http://localhost:3000).

## Deployment

The project includes a `Dockerfile` for easy deployment.

```
Port: 3000
Build: Dockerfile
```

## Stack

- **Server**: Node.js / Express
- **Client**: Vanilla JS, no framework
- **QR**: `qrcode` npm package (server-side generation)
