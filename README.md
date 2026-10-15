# Guest Room Manager (9 rooms)

A local full-stack booking app for exactly nine rooms, built with React, Vite, Node.js, Express, MongoDB, and JWT admin authentication.

## Features

- Admin login
- Fixed inventory: Room 1 through Room 9
- Searchable visitor history
- Manual room selection after checking availability
- Date-overlap validation; checkout day is not an occupied night
- Cancelled bookings are retained in history and do not block room dates
- Server-side recheck before saving a booking
- Booking IDs, check-in/check-out status, dashboard, print receipt
- Responsive layout for desktop and mobile screens

## Requirements

- Node.js 20 or later
- MongoDB Community running locally, or a MongoDB Atlas connection string
- A desktop browser

## 1. Configure the app

Copy `.env.example` to `.env` in the project root. Set a long random `JWT_SECRET`. Configure `MONGODB_URI` for your MongoDB instance.

Create a bcrypt hash for your admin password:

```bash
node -e "require('bcryptjs').hash('ChangeThisPassword!', 12).then(console.log)"
```

Copy the output hash into `ADMIN_PASSWORD_HASH` in `.env`, and change `ADMIN_USERNAME` if desired. Do not commit `.env` to source control.

Example `.env`:

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/guest_room_manager
JWT_SECRET=put-a-random-secret-of-at-least-24-characters-here
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2a$12$paste_the_generated_hash_here
CLIENT_ORIGIN=http://localhost:5173
```

Use a real generated hash; the example above is only a placeholder.

## 2. Install dependencies

From this project directory:

```bash
npm install
```

## 3. Start MongoDB

Ensure the MongoDB service is running locally. If using Atlas, use its connection string in `MONGODB_URI` and make sure network access and database credentials are configured.

## 4. Run the app in development

```bash
npm run dev
```

Open http://localhost:5173 and sign in using the username/password configured in `.env`.

The React frontend runs on port 5173 and proxies `/api` requests to the Express server on port 5000.

## 5. Production build

```bash
npm run build
npm start
```

Then open http://localhost:5000. The Express server serves the built frontend and API from the same origin.

## Booking rules

- A booking occupies nights from check-in up to, but not including, check-out.
- Two stays conflict when `existing.checkIn < new.checkOut && existing.checkOut > new.checkIn`.
- A cancelled booking does not block dates.
- The frontend asks the server for available rooms, and the server checks again at booking creation. If a room became unavailable, the booking is rejected with HTTP 409.
- The app uses a serialized allocation queue within one Node process, suitable for the requested single-admin/local use. Do not run multiple API instances with this queue as the only protection. For multi-user/multi-instance deployment, move allocation into a MongoDB transaction on a replica set or use an atomic reservation/locking design.

## Important security notes

- The app uses a bearer JWT stored in `sessionStorage`, so it is cleared when the browser session ends. For a public production deployment, prefer secure, HttpOnly, SameSite cookies, HTTPS, a strong password policy, backups, audit logs, and a managed secret store.
- This starter is designed for one admin on one computer, not as a hardened public internet service.
- Set `CLIENT_ORIGIN` to the actual frontend origin when deploying separately.
- Back up MongoDB regularly because it contains personal visitor information.

## API summary

All routes except `/api/health` and `/api/auth/login` require `Authorization: Bearer <token>`.

- `POST /api/auth/login`
- `GET /api/rooms`
- `GET /api/bookings?search=...&status=Booked`
- `GET /api/dashboard?date=YYYY-MM-DD`
- `POST /api/bookings/availability` with `{ "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD" }`
- `POST /api/bookings` with visitor fields, room number, and dates
- `PATCH /api/bookings/:id/status` with `{ "status": "Checked-in" }`
- `DELETE /api/bookings/:id` cancels (soft-cancels) a booking
