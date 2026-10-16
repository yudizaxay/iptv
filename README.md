<div align="center">

<img src="public/favicon.svg" alt="IPTV Web Player logo" width="110" height="110">

# IPTV Web Player

**Watch your own IPTV channels in any browser. Nothing to install.**

Sign in, add an Xtream account or an M3U playlist, pick a channel and press play.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![HLS](https://img.shields.io/badge/HLS%20%2B%20MPEG--TS-supported-6b86ff)
![Theme](https://img.shields.io/badge/theme-light%20%7C%20dark-8a4dff)
![Responsive](https://img.shields.io/badge/layout-responsive-2ea44f)

[Features](#-features) · [Quick start](#-quick-start) · [How to use](#-how-to-use) · [Deploy](#-deploy-it) · [API](#-api) · [Security](#-before-you-make-it-public)

</div>

> [!IMPORTANT]
> This project **does not provide any channels or content.** You bring your own playlist or provider account. Only use sources you have the right to watch.

---

## ✨ Features

| | |
| --- | --- |
| 🔐 **Accounts** | Sign up and sign in. Passwords are hashed with scrypt. |
| 🔌 **Two ways to connect** | **Xtream login** (server, username, password) or an **M3U playlist URL**. |
| 🗂️ **Many connections** | Save several providers and switch between them. |
| 📺 **Channel browser** | Categories, live search and favourites. |
| ▶️ **Playback** | HLS (`.m3u8`) and MPEG-TS (`.ts`) in the browser via [hls.js](https://github.com/video-dev/hls.js) and [mpegts.js](https://github.com/xqq/mpegts.js). |
| 🛰️ **Stream proxy** | Built in, so providers that block cross-origin or mixed-content requests still play. |
| 🌗 **Light and dark theme** | Follows your system, remembers your choice. |
| 📱 **Responsive** | Desktop, tablet and phone. |
| 🤖 **Demo account** | Try the player without a provider. |

---

## 🧰 Requirements

- [Node.js](https://nodejs.org) **18 or newer**
- npm (comes with Node.js)

Check your versions:

```bash
node -v
npm -v
```

---

## 🚀 Quick start

### 1. Get the code

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the server

```bash
npm start
```

You should see:

```
IPTV Web Player running on http://localhost:3000  (demo login: demo / demo123)
```

### 4. Open it

Go to **<http://localhost:3000>** and sign in with the demo account:

| Username | Password |
| --- | --- |
| `demo` | `demo123` |

### Use another port

```bash
PORT=8080 npm start
```

On Windows PowerShell: `$env:PORT=8080; npm start`

### Port already in use?

If you see `EADDRINUSE`, another program is using the port. Pick a different one with `PORT=...`, or stop the other program.

---

## 📖 How to use

### Try it with the demo account

1. Sign in with `demo` / `demo123`.
2. On **Connections**, click **Fill in the demo account**.
3. Click **Save & open**.
4. Pick a channel on the left. It starts playing.

### Add your own Xtream account

1. On **Connections**, stay on the **Xtream login** tab.
2. Enter a name (optional) and your **Server URL**, for example `http://server.example.com:8080`.
3. Enter your **Username** and **Password**.
4. Click **Save & open**.

### Add an M3U playlist

1. On **Connections**, switch to the **M3U URL** tab.
2. Paste the full **Playlist URL** from your provider.
3. Click **Save & open**.

> Looking for something to test with? The public lists from [iptv-org](https://github.com/iptv-org/iptv) work well.

### Watch

1. Choose a category in the left column, or type in the search box.
2. Click a channel to play it.
3. Click the star next to the channel name to add it to **Favourites**. Favourites are saved per device.
4. Use the sun/moon button in the header to switch between light and dark.

### Manage connections

- Click a connection to open it.
- Click the bin icon, then click **Delete?** within 3 seconds to remove it.

### If a channel won't play

| Message | What it usually means |
| --- | --- |
| The provider blocked access (HTTP 403) | The stream is geo-restricted or protected. |
| This channel link is no longer active (HTTP 404) | The provider removed the link. |
| The provider did not respond | The provider is offline or too slow. |

Some streams can't play in a browser at all. That is a limit of the stream, not of the player.

---

## 🗺️ Project structure

```
.
├── server.js          Express server: auth, saved sources, channel parsing, stream proxy
├── public/
│   ├── index.html     Sign-in, connections and player screens
│   ├── style.css      Styles and light/dark themes
│   ├── app.js         Front-end logic
│   └── favicon.svg    Logo and browser icon
├── data/db.json       Created at runtime: users and saved sources (git-ignored)
├── package.json
└── .gitignore
```

---

## 🌍 Deploy it

This is a Node server, so it needs a host that runs Node, such as Render, Railway, Fly.io or your own VPS. Static-only hosts such as GitHub Pages or Cloudflare Pages **cannot** run it.

### Option A: Render (step by step)

1. Push this project to GitHub. Make sure `node_modules/` and `data/db.json` are **not** in the repo.
2. Sign in to [Render](https://render.com) and choose **New → Web Service**.
3. Connect your GitHub account and select this repository.
4. Set:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
5. Click **Create Web Service** and wait for the first deploy.
6. Open the `.onrender.com` link Render gives you.

### Option B: Your own server (VPS)

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
npm install
PORT=3000 npm start
```

For a long-running service, use a process manager such as [pm2](https://pm2.keymetrics.io) (`pm2 start server.js --name iptv`) and put nginx or Caddy in front of it for HTTPS.

### Storage on a host

Users and saved sources live in `data/db.json`. Many hosts erase the disk on restart or redeploy, so use a persistent disk, or move storage to a real database, before real users rely on it.

To keep the data on a mounted disk, set the `DATA_DIR` environment variable to that disk's path (for example `DATA_DIR=/var/data`). The folder is created automatically.

---

## 🔌 API

All routes except register, login and the demo routes need a session token, sent as `Authorization: Bearer <token>`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/register` | Create an account |
| `POST` | `/api/login` | Sign in, returns a token |
| `POST` | `/api/logout` | End the session |
| `GET` | `/api/me` | Current user |
| `GET` | `/api/sources` | List saved connections |
| `POST` | `/api/sources` | Add a connection |
| `DELETE` | `/api/sources/:id` | Remove a connection |
| `GET` | `/api/sources/:id/channels` | Load and parse channels |
| `GET` | `/proxy?u=<url>&t=<token>` | Stream proxy |

Example:

```bash
# sign in
curl -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo123"}'

# list connections with the token you got back
curl http://localhost:3000/api/sources -H 'Authorization: Bearer <token>'
```

---

## 🛡️ Before you make it public

This started as an MVP. Before opening it to the internet, know its limits:

- **Storage:** a JSON file holds accounts and saved providers. Provider passwords are stored as plain text so the server can use them.
- **Sessions:** kept in memory, so everyone is signed out when the server restarts.
- **Open sign-up and proxy:** anyone can create an account, and the proxy fetches any `http(s)` address a signed-in user gives it. On a public server, restrict sign-up and block private and internal addresses in the proxy.
- **No rate limiting** on login or the proxy.
- **Never commit `data/db.json`.** It holds real accounts and provider logins. It is already in `.gitignore`.

---

## 🧱 Built with

[Node.js](https://nodejs.org) · [Express](https://expressjs.com) · [hls.js](https://github.com/video-dev/hls.js) · [mpegts.js](https://github.com/xqq/mpegts.js)

The front end is plain HTML, CSS and JavaScript, with no build step.

---

## 🤝 Contributing

Issues and pull requests are welcome. For larger changes, open an issue first to discuss what you'd like to change.

1. Fork the repository.
2. Create a branch: `git checkout -b my-change`.
3. Commit your work and push the branch.
4. Open a pull request.

---

## ⚖️ Disclaimer

This software is a player only. The authors don't host, supply or endorse any streams. You're responsible for the sources you add and for following the laws that apply to you.
