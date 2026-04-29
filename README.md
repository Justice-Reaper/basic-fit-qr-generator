# BasicShare

BasicFit QR code generator

## Features

- Generate your BasicFit entry QR code
- Enter the gym and use the massage chair
- View your membership plan, extras, and last visit
- Re-entry cooldown timer
- Auto-refresh dashboard data when returning to the app
- Works on desktop and mobile
- Dark theme

## Login

Sign in with your BasicFit account via OAuth. Follow the on-screen steps to copy the authorization link and connect

## Running locally

```
npm install
node server.js
```

Open [http://localhost:3000](http://localhost:3000).

## Deployment

The project includes a `Dockerfile` for easy deployment

```
Port: 3000
Build: Dockerfile
```

## Stack

- **Server**: Node.js / Express
- **Client**: Vanilla JS, no framework
- **QR**: `qrcode` npm package (server-side generation)
