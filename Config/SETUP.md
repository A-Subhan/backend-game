# Lucky Guess — Setup Instructions
## by Contoura Labs

---

## Prerequisites

- **Node.js** 18+ (https://nodejs.org)
- **npm** 9+ (comes with Node.js)
- **React Native CLI** — no Expo
- **Android Studio** (for Android builds)
- **Supabase** account (free tier)
- **Google Cloud Console** (for Google Sign-In, optional for guest-only testing)

---

## 1. Database Setup (Supabase)

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in your Supabase dashboard
3. Copy and run the entire contents of `supabase-schema.sql`
4. Go to **Settings > API** and note:
   - **Project URL** (SUPABASE_URL)
   - **anon public key** (SUPABASE_ANON_KEY)
   - **service_role key** (SUPABASE_SERVICE_KEY) — keep this secret!

---

## 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env with your Supabase credentials and JWT secret
# nano .env  (or use your preferred editor)
```

### Configure .env

```env
PORT=3001
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
GOOGLE_CLIENT_ID=your-google-client-id
JWT_SECRET=generate-a-random-string-here
FRONTEND_URL=http://localhost:3000
NODE_ENV=development
```

### Start Backend

```bash
npm run dev
```

Server runs on `http://localhost:3001`. Verify with `http://localhost:3001/health`.

---

## 3. Frontend Setup (React Native CLI)

### 3a. Install React Native CLI globally

```bash
npm install -g react-native-cli
```

### 3b. Install frontend dependencies

```bash
cd frontend

npm install

# Additional native dependencies
npm install react-native-vector-icons
npm install @react-native-async-storage/async-storage
npm install react-native-screens react-native-safe-area-context
npm install react-native-svg
npm install react-native-gesture-handler
npm install @react-native-google-signin/google-signin
npm install react-native-haptic-feedback
npm install react-native-sound
npm install socket.io-client @supabase/supabase-js
npm install babel-plugin-module-resolver

# Dev dependencies
npm install -D @types/react @types/react-native
npm install -D react-native-reanimated
```

### 3c. Configure Google Sign-In (optional — guest login works without this)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable **Google Sign-In API**
4. Create **OAuth 2.0 Client ID** (Web application type)
5. Copy the **Client ID**
6. Add it to `frontend/.env` as `GOOGLE_WEB_CLIENT_ID`
7. For Android: Follow [React Native Google Sign-In Android setup](https://github.com/react-native-google-signin/google-signin#android)

### 3d. Configure environment

Edit `frontend/.env`:

```env
API_BASE_URL=http://10.0.2.2:3001
SOCKET_URL=http://10.0.2.2:3001
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your-anon-key
GOOGLE_WEB_CLIENT_ID=your-google-web-client-id
```

> Note: `10.0.2.2` is the Android emulator's way to access `localhost` on the host machine. For a physical device, use your computer's local IP (e.g., `192.168.1.x`).

### 3e. Setup for Android

```bash
# If you don't have an Android project yet, initialize:
npx react-native init LuckyGuess --template react-native-template-typescript

# Then copy the contents of this frontend/ folder into that project

# For vector icons, add to android/app/build.gradle:
# apply from: "../../node_modules/react-native-vector-icons/fonts.gradle"

# Run on Android emulator:
npx react-native run-android

# Run on connected physical device:
npx react-native run-android --device
```

### 3f. Link native modules (if needed)

Most dependencies auto-link. If you encounter issues:

```bash
npx react-native link
cd ios && pod install  # For iOS (requires macOS)
```

---

## 4. Project Structure

```
lucky-guess/
├── shared/                    # Shared types & constants
│   ├── types.ts               # TypeScript interfaces
│   └── constants.ts           # Game configs, achievements, storage keys
│
├── backend/                   # Node.js + Express + Socket.IO
│   ├── src/
│   │   ├── index.ts           # Server entry point
│   │   ├── config/
│   │   │   ├── env.ts         # Environment variable loader
│   │   │   └── database.ts    # Supabase client init
│   │   ├── middleware/
│   │   │   └── auth.ts        # JWT auth middleware
│   │   ├── routes/
│   │   │   ├── authRoutes.ts  # /auth/* endpoints
│   │   │   ├── userRoutes.ts  # /user/* endpoints
│   │   │   └── leaderboardRoutes.ts
│   │   ├── controllers/
│   │   │   ├── authController.ts
│   │   │   ├── userController.ts
│   │   │   └── leaderboardController.ts
│   │   ├── services/
│   │   │   ├── matchmaking.ts     # Queue system
│   │   │   ├── gameService.ts     # Game logic
│   │   │   ├── eloService.ts      # ELO calculation
│   │   │   ├── coinService.ts     # Coin management
│   │   │   └── achievementService.ts
│   │   └── socket/
│   │       ├── index.ts
│   │       └── handlers.ts    # Socket.IO event handlers
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
│
├── frontend/                  # React Native CLI app
│   ├── src/
│   │   ├── screens/           # All app screens
│   │   ├── components/        # Reusable UI components
│   │   ├── navigation/        # React Navigation setup
│   │   ├── context/           # React Context providers
│   │   ├── services/          # API, Socket, Auth services
│   │   ├── utils/             # Sound, haptics, API helpers
│   │   ├── styles/            # Global styles
│   │   └── assets/            # Images, sounds
│   ├── App.tsx                # App entry
│   ├── index.js               # RN registerComponent
│   ├── package.json
│   ├── babel.config.js
│   ├── metro.config.js
│   └── tsconfig.json
│
└── supabase-schema.sql        # Database schema
```

---

## 5. Game Modes

### Single Player
- Works 100% offline (no server needed)
- 4 difficulty levels: Easy (1-50), Medium (1-100), Hard (1-500), Custom
- Hints: Higher / Lower
- Sound + haptic feedback

### Local Multiplayer
- Works 100% offline (same device)
- Pass & Play system with transition screens
- Player 1 sets secret number, Player 2 guesses, then Player 1 guesses
- Fewer attempts wins

### Online Multiplayer
- **Requires running backend + Supabase**
- Real-time matchmaking via Socket.IO
- Both players guess the same secret number
- First to guess correctly wins
- ELO + coins updated in real-time

---

## 6. Deployment

### Backend (Render — Free Tier)

1. Push code to GitHub/GitLab
2. Create a new **Web Service** on [render.com](https://render.com)
3. Connect your repository
4. Set:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run build && npm start`
5. Add environment variables from `.env.example`
6. Deploy!

### Database (Supabase — Free Tier)

Already set up in Step 1. No additional deployment needed.

### Frontend (Android APK)

```bash
cd frontend/android
./gradlew assembleRelease
```

APK will be at `android/app/build/outputs/apk/release/`.

---

## 7. Troubleshooting

| Issue | Solution |
|-------|----------|
| `Cannot find module '@shared/...'` | Ensure `tsconfig-paths` is installed in backend and `babel-plugin-module-resolver` in frontend |
| Socket connection fails | Check `SOCKET_URL` — use `10.0.2.2` for emulator, local IP for physical device |
| Google Sign-In crashes | Follow full Google Sign-In setup guide or use Guest Login |
| Metro can't find shared files | Verify `watchFolders` in `metro.config.js` includes `../shared` |
| Supabase RLS errors | Run the SQL schema — RLS policies are included |
| Port 3001 already in use | Change `PORT` in backend `.env` |

---

## 8. Quick Start (Guest Mode — No Google, No Server)

1. Setup Supabase and run the SQL schema
2. Start the backend: `cd backend && npm install && npm run dev`
3. Start the frontend: `cd frontend && npm install && npx react-native run-android`
4. Tap **"Continue as Guest"** on the login screen
5. Play **Single Player** or **Local Multiplayer** — these work without server
6. For Online Multiplayer, ensure backend is running and Supabase is configured

---

Built with ❤️ by Contoura Labs